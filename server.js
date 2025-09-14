const mongoose = require("mongoose");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require('bcrypt');
const http = require('http');
const socketIo = require('socket.io');

const Patient = require("./models/Patient");
const Doctor = require("./models/Doctor");

// Connect to MongoDB
const MONGO_URI = "mongodb+srv://_db_user:KDHHiZHhRsRrD6fN@aihealthmatecluster.ryau30r.mongodb.net/?retryWrites=true&w=majority&appName=AIHealthMateCluster";

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.log("MongoDB connection error:", err));

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 5000;

app.use(cors());
app.use(bodyParser.json());

// Store online users and call requests
const onlineUsers = new Map(); // userId -> socket info
const onlineDoctors = new Map(); // doctorId -> doctor info
const onlinePatients = new Map(); // patientId -> patient info
const activeCallRequests = new Map(); // requestId -> call info
const activeCalls = new Map(); // roomId -> call info

// ---------------- Socket.IO Events ----------------
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User joins (patient or doctor)
    socket.on('join-as-user', (data) => {
        const { userId, userType, userName } = data;
        
        console.log(`User joining: ${userName} as ${userType} with ID: ${userId}`);
        
        // Store user info
        onlineUsers.set(userId, {
            socketId: socket.id,
            userType,
            userName,
            status: 'online'
        });

        socket.userId = userId;
        socket.userType = userType;
        socket.userName = userName;

        if (userType === 'doctor') {
            onlineDoctors.set(userId, {
                id: userId,
                name: userName,
                status: 'online',
                socketId: socket.id
            });
            
            console.log(`Doctor ${userName} joined. Online doctors: ${onlineDoctors.size}`);
            console.log('Current online doctors:', Array.from(onlineDoctors.keys()));
            
            // Send waiting patients to this doctor
            const waitingPatients = Array.from(activeCallRequests.values())
                .filter(req => req.status === 'waiting')
                .map(req => ({
                    id: req.patientId,
                    name: req.patientName,
                    requestId: req.requestId
                }));
            
            socket.emit('waiting-patients', waitingPatients);
            
        } else if (userType === 'patient') {
            onlinePatients.set(userId, {
                id: userId,
                name: userName,
                socketId: socket.id
            });
            
            console.log(`Patient ${userName} joined. Online patients: ${onlinePatients.size}`);
            
            // Send online doctors to this patient
            const doctorsList = Array.from(onlineDoctors.values());
            socket.emit('doctors-online', doctorsList);
        }

        // Broadcast updated lists to all users
        broadcastOnlineDoctors();
        broadcastWaitingPatients();
    });

    // Patient requests video call
    socket.on('request-video-call', (data) => {
        const { patientId, patientName } = data;
        
        console.log(`Video call request from ${patientName} (${patientId})`);
        console.log(`Available doctors: ${onlineDoctors.size}`);
        
        if (onlineDoctors.size === 0) {
            console.log('No doctors online, rejecting call');
            socket.emit('call-rejected', {
                doctorName: 'System',
                message: 'No doctors currently online'
            });
            return;
        }

        const requestId = `req_${Date.now()}_${patientId}`;
        const callRequest = {
            requestId,
            patientId,
            patientName,
            patientSocketId: socket.id,
            status: 'waiting',
            timestamp: Date.now()
        };

        activeCallRequests.set(requestId, callRequest);
        console.log(`Call request created: ${requestId}`);

        // Notify all online doctors about the call request
        let doctorsNotified = 0;
        onlineDoctors.forEach((doctor) => {
            const doctorSocket = io.sockets.sockets.get(doctor.socketId);
            if (doctorSocket && doctorSocket.connected) {
                console.log(`Sending call request to doctor: ${doctor.name} (${doctor.socketId})`);
                doctorSocket.emit('incoming-call-request', {
                    patientId,
                    patientName,
                    requestId
                });
                doctorsNotified++;
            } else {
                console.log(`Doctor ${doctor.name} socket not found or disconnected`);
                // Remove disconnected doctor
                onlineDoctors.delete(doctor.id);
            }
        });

        console.log(`Call request sent to ${doctorsNotified} doctors`);
        
        if (doctorsNotified === 0) {
            socket.emit('call-rejected', {
                doctorName: 'System',
                message: 'No doctors available at the moment'
            });
            activeCallRequests.delete(requestId);
            return;
        }

        broadcastWaitingPatients();
        
        // Auto-cancel request after 2 minutes
        setTimeout(() => {
            const request = activeCallRequests.get(requestId);
            if (request && request.status === 'waiting') {
                console.log(`Auto-cancelling request ${requestId} after timeout`);
                activeCallRequests.delete(requestId);
                const patientSocket = io.sockets.sockets.get(request.patientSocketId);
                if (patientSocket) {
                    patientSocket.emit('call-rejected', {
                        doctorName: 'System',
                        message: 'No doctors available at the moment'
                    });
                }
                broadcastWaitingPatients();
            }
        }, 120000); // 2 minutes
    });

    // Doctor accepts call
    socket.on('accept-call', (data) => {
        const { patientId, doctorId, doctorName } = data;
        
        console.log(`Doctor ${doctorName} attempting to accept call from patient ${patientId}`);
        
        // Find the call request
        let requestToAccept = null;
        let requestId = null;
        
        for (const [rid, request] of activeCallRequests.entries()) {
            if (request.patientId === patientId && request.status === 'waiting') {
                requestToAccept = request;
                requestId = rid;
                break;
            }
        }

        if (!requestToAccept) {
            console.log(`Call request not found or already taken for patient ${patientId}`);
            socket.emit('call-taken', { patientId });
            return;
        }

        // Mark request as accepted
        requestToAccept.status = 'accepted';
        requestToAccept.doctorId = doctorId;
        requestToAccept.doctorName = doctorName;
        requestToAccept.doctorSocketId = socket.id;

        // Create room for the call
        const roomId = `room_${patientId}_${doctorId}_${Date.now()}`;
        
        console.log(`Creating call room: ${roomId}`);
        
        // Join both users to the room
        socket.join(roomId);
        const patientSocket = io.sockets.sockets.get(requestToAccept.patientSocketId);
        if (patientSocket) {
            patientSocket.join(roomId);
            console.log('Patient joined room');
        } else {
            console.log('Patient socket not found');
        }

        // Create active call record
        activeCalls.set(roomId, {
            roomId,
            patientId,
            doctorId,
            patientName: requestToAccept.patientName,
            doctorName,
            status: 'active',
            startTime: Date.now()
        });

        // Notify patient that call was accepted
        if (patientSocket) {
            patientSocket.emit('call-accepted', {
                roomId,
                doctorName,
                doctorId
            });
            console.log('Sent call-accepted to patient');
        }

        // Notify doctor that call started
        socket.emit('call-started', {
            roomId,
            patientId,
            patientName: requestToAccept.patientName
        });
        console.log('Sent call-started to doctor');

        // Remove the request and notify other doctors
        activeCallRequests.delete(requestId);
        
        // Notify other doctors that this call was taken
        onlineDoctors.forEach((doctor) => {
            if (doctor.id !== doctorId) {
                const doctorSocket = io.sockets.sockets.get(doctor.socketId);
                if (doctorSocket) {
                    doctorSocket.emit('call-taken', { patientId });
                }
            }
        });

        broadcastWaitingPatients();
        console.log(`Call accepted by Dr. ${doctorName} for patient ${requestToAccept.patientName} (Room: ${roomId})`);
    });

    // Doctor rejects call
    socket.on('reject-call', (data) => {
        const { patientId, doctorId } = data;
        console.log(`Dr. ${socket.userName} rejected call from patient ${patientId}`);
        // Individual rejection - call request remains for other doctors
        // Could add logic here to track which doctors rejected
    });

    // WebRTC Signaling
    socket.on('webrtc-offer', (data) => {
        const { roomId, offer } = data;
        console.log(`WebRTC offer received for room ${roomId}`);
        socket.to(roomId).emit('webrtc-offer', {
            offer,
            from: socket.userId
        });
        console.log(`WebRTC offer sent to room ${roomId}`);
    });

    socket.on('webrtc-answer', (data) => {
        const { roomId, answer } = data;
        console.log(`WebRTC answer received for room ${roomId}`);
        socket.to(roomId).emit('webrtc-answer', {
            answer,
            from: socket.userId
        });
        console.log(`WebRTC answer sent to room ${roomId}`);
    });

    socket.on('webrtc-ice-candidate', (data) => {
        const { roomId, candidate } = data;
        socket.to(roomId).emit('webrtc-ice-candidate', {
            candidate,
            from: socket.userId
        });
    });

    // End call
    socket.on('end-call', (data) => {
        const { roomId } = data;
        const call = activeCalls.get(roomId);
        
        if (call) {
            // Notify other participant
            socket.to(roomId).emit('call-ended');
            
            // Clean up
            activeCalls.delete(roomId);
            console.log(`Call ended in room ${roomId}`);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (socket.userId) {
            console.log(`User ${socket.userName} (${socket.userType}) disconnected`);
            
            // Remove from online users
            onlineUsers.delete(socket.userId);
            
            if (socket.userType === 'doctor') {
                onlineDoctors.delete(socket.userId);
                console.log(`Doctor removed. Online doctors now: ${onlineDoctors.size}`);
                broadcastOnlineDoctors();
            } else if (socket.userType === 'patient') {
                onlinePatients.delete(socket.userId);
                
                // Cancel any active call requests from this patient
                for (const [requestId, request] of activeCallRequests.entries()) {
                    if (request.patientId === socket.userId) {
                        console.log(`Cancelling call request ${requestId} due to patient disconnect`);
                        activeCallRequests.delete(requestId);
                    }
                }
                broadcastWaitingPatients();
            }

            // End any active calls this user was in
            for (const [roomId, call] of activeCalls.entries()) {
                if (call.patientId === socket.userId || call.doctorId === socket.userId) {
                    console.log(`Ending call ${roomId} due to user disconnect`);
                    socket.to(roomId).emit('call-ended');
                    activeCalls.delete(roomId);
                }
            }
        }
    });
});

// Broadcast online doctors to all patients
function broadcastOnlineDoctors() {
    const doctorsList = Array.from(onlineDoctors.values());
    console.log(`Broadcasting ${doctorsList.length} online doctors to ${onlinePatients.size} patients`);
    
    onlinePatients.forEach((patient) => {
        const patientSocket = io.sockets.sockets.get(patient.socketId);
        if (patientSocket && patientSocket.connected) {
            patientSocket.emit('doctors-online', doctorsList);
        }
    });
}

// Broadcast waiting patients to all doctors
function broadcastWaitingPatients() {
    const waitingPatients = Array.from(activeCallRequests.values())
        .filter(req => req.status === 'waiting')
        .map(req => ({
            id: req.patientId,
            name: req.patientName,
            requestId: req.requestId
        }));
    
    console.log(`Broadcasting ${waitingPatients.length} waiting patients to ${onlineDoctors.size} doctors`);
    
    onlineDoctors.forEach((doctor) => {
        const doctorSocket = io.sockets.sockets.get(doctor.socketId);
        if (doctorSocket && doctorSocket.connected) {
            doctorSocket.emit('waiting-patients', waitingPatients);
        }
    });
}

// ---------------- REST API Routes ----------------

// Patient Signup
app.post("/api/auth/patient/signup", async (req, res) => {
    const { name, email, phone, age, password } = req.body;
    
    if (!name || !email || !phone || !age || !password) {
        return res.status(400).json({ message: "All fields are required" });
    }

    try {
        const existing = await Patient.findOne({ email });
        if (existing) {
            return res.status(400).json({ message: "Email already registered" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newPatient = await Patient.create({ 
            name, 
            email, 
            phone, 
            age, 
            password: hashedPassword
        });

        const patientResponse = { ...newPatient.toObject() };
        delete patientResponse.password;

        res.status(201).json({ 
            message: "Patient registered successfully", 
            user: patientResponse 
        });
    } catch (err) {
        console.error("Patient signup error:", err);
        res.status(500).json({ message: "Server error during registration" });
    }
});

// Doctor Signup
app.post("/api/auth/doctor/signup", async (req, res) => {
    const { name, email, license, specialty, password } = req.body;
    
    if (!name || !email || !license || !specialty || !password) {
        return res.status(400).json({ message: "All fields are required" });
    }

    try {
        const existing = await Doctor.findOne({ $or: [{ email }, { license }] });
        if (existing) {
            return res.status(400).json({ message: "Doctor already registered with this email or license" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newDoctor = await Doctor.create({ 
            name, 
            email, 
            license, 
            specialty, 
            password: hashedPassword
        });

        const doctorResponse = { ...newDoctor.toObject() };
        delete doctorResponse.password;

        res.status(201).json({ 
            message: "Doctor registered successfully", 
            user: doctorResponse
        });
    } catch (err) {
        console.error("Doctor signup error:", err);
        res.status(500).json({ message: "Server error during registration" });
    }
});

// Patient Login
app.post("/api/auth/patient/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
    }

    try {
        const patient = await Patient.findOne({ email });
        if (!patient) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        const isValidPassword = await bcrypt.compare(password, patient.password);
        if (!isValidPassword) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        const patientResponse = { ...patient.toObject() };
        delete patientResponse.password;

        res.json({ 
            message: "Login successful", 
            user: patientResponse, 
            token: "dummy-patient-token" 
        });
    } catch (err) {
        console.error("Patient login error:", err);
        res.status(500).json({ message: "Server error during login" });
    }
});

// Doctor Login
app.post("/api/auth/doctor/login", async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
    }

    try {
        const doctor = await Doctor.findOne({ email });
        if (!doctor) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        const isValidPassword = await bcrypt.compare(password, doctor.password);
        if (!isValidPassword) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        const doctorResponse = { ...doctor.toObject() };
        delete doctorResponse.password;

        res.json({ 
            message: "Login successful", 
            user: doctorResponse, 
            token: "dummy-doctor-token" 
        });
    } catch (err) {
        console.error("Doctor login error:", err);
        res.status(500).json({ message: "Server error during login" });
    }
});

// Health check endpoint
app.get("/api/health", (req, res) => {
    res.json({ 
        message: "Server is running", 
        timestamp: new Date().toISOString(),
        onlineDoctors: onlineDoctors.size,
        onlinePatients: onlinePatients.size,
        activeCalls: activeCalls.size,
        activeRequests: activeCallRequests.size,
        doctorsList: Array.from(onlineDoctors.keys()),
        patientsList: Array.from(onlinePatients.keys())
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log('Socket.IO server initialized');
});
