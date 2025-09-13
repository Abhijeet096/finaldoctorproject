require('dotenv').config();
const mongoose = require("mongoose");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require('bcrypt');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const Patient = require("./models/Patient");
const Doctor = require("./models/Doctor");

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI;

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

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

// Store online users and call rooms
const onlineUsers = new Map(); // userId -> socketId
const callRooms = new Map(); // roomId -> { patientId, doctorId, status }
const onlineDoctors = new Set(); // Set of online doctor IDs

// ---------------- Socket.IO Video Call Logic ----------------
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User joins as patient or doctor
    socket.on('join-as-user', (data) => {
        const { userId, userType, userName } = data;
        onlineUsers.set(userId, { 
            socketId: socket.id, 
            userType, 
            userName,
            status: 'online'
        });
        
        if (userType === 'doctor') {
            onlineDoctors.add(userId);
            // Send current waiting patients to newly connected doctor
            socket.emit('waiting-patients', Array.from(onlineUsers.entries())
                .filter(([id, user]) => user.userType === 'patient' && user.status === 'waiting')
                .map(([id, user]) => ({ id, name: user.userName }))
            );
        }
        
        console.log(`${userType} ${userName} joined with ID: ${userId}`);
        
        // Broadcast online doctors to all patients
        if (userType === 'doctor') {
            io.emit('doctors-online', Array.from(onlineUsers.entries())
                .filter(([id, user]) => user.userType === 'doctor')
                .map(([id, user]) => ({ id, name: user.userName, status: user.status }))
            );
        }
    });

    // Patient requests video call
    socket.on('request-video-call', (data) => {
        const { patientId, patientName } = data;
        
        // Update patient status to waiting
        if (onlineUsers.has(patientId)) {
            onlineUsers.get(patientId).status = 'waiting';
        }
        
        // Broadcast to all online doctors
        onlineUsers.forEach((user, userId) => {
            if (user.userType === 'doctor') {
                io.to(user.socketId).emit('incoming-call-request', {
                    patientId,
                    patientName,
                    requestId: uuidv4()
                });
            }
        });
        
        console.log(`Patient ${patientName} requesting video call`);
    });

    // Doctor accepts call
    socket.on('accept-call', (data) => {
        const { patientId, doctorId, doctorName } = data;
        const roomId = uuidv4();
        
        // Create call room
        callRooms.set(roomId, {
            patientId,
            doctorId,
            status: 'active'
        });
        
        // Update user statuses
        if (onlineUsers.has(patientId)) {
            onlineUsers.get(patientId).status = 'in-call';
        }
        if (onlineUsers.has(doctorId)) {
            onlineUsers.get(doctorId).status = 'in-call';
        }
        
        const patientSocket = onlineUsers.get(patientId)?.socketId;
        const doctorSocket = onlineUsers.get(doctorId)?.socketId;
        
        if (patientSocket && doctorSocket) {
            // Join both users to the room
            socket.join(roomId);
            io.sockets.sockets.get(patientSocket)?.join(roomId);
            
            // Notify both parties
            io.to(patientSocket).emit('call-accepted', {
                roomId,
                doctorName,
                doctorId
            });
            
            io.to(doctorSocket).emit('call-started', {
                roomId,
                patientId,
                patientName: onlineUsers.get(patientId)?.userName
            });
            
            console.log(`Call started between patient ${patientId} and doctor ${doctorId}`);
            
            // Remove call request from other doctors
            onlineUsers.forEach((user, userId) => {
                if (user.userType === 'doctor' && userId !== doctorId) {
                    io.to(user.socketId).emit('call-taken', { patientId });
                }
            });
        }
    });

    // Doctor rejects call
    socket.on('reject-call', (data) => {
        const { patientId, doctorId } = data;
        
        const patientSocket = onlineUsers.get(patientId)?.socketId;
        if (patientSocket) {
            io.to(patientSocket).emit('call-rejected', {
                doctorId,
                doctorName: onlineUsers.get(doctorId)?.userName
            });
        }
        
        console.log(`Doctor ${doctorId} rejected call from patient ${patientId}`);
    });

    // WebRTC signaling
    socket.on('webrtc-offer', (data) => {
        const { roomId, offer } = data;
        socket.to(roomId).emit('webrtc-offer', { offer, from: socket.id });
    });

    socket.on('webrtc-answer', (data) => {
        const { roomId, answer } = data;
        socket.to(roomId).emit('webrtc-answer', { answer, from: socket.id });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        const { roomId, candidate } = data;
        socket.to(roomId).emit('webrtc-ice-candidate', { candidate, from: socket.id });
    });

    // End call
    socket.on('end-call', (data) => {
        const { roomId } = data;
        const room = callRooms.get(roomId);
        
        if (room) {
            // Update user statuses back to online
            if (onlineUsers.has(room.patientId)) {
                onlineUsers.get(room.patientId).status = 'online';
            }
            if (onlineUsers.has(room.doctorId)) {
                onlineUsers.get(room.doctorId).status = 'online';
            }
            
            // Notify all users in the room
            io.to(roomId).emit('call-ended');
            
            // Remove the room
            callRooms.delete(roomId);
            
            console.log(`Call ended in room ${roomId}`);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Find and remove user from online users
        let disconnectedUser = null;
        let disconnectedUserId = null;
        
        for (let [userId, user] of onlineUsers.entries()) {
            if (user.socketId === socket.id) {
                disconnectedUser = user;
                disconnectedUserId = userId;
                break;
            }
        }
        
        if (disconnectedUser) {
            onlineUsers.delete(disconnectedUserId);
            
            if (disconnectedUser.userType === 'doctor') {
                onlineDoctors.delete(disconnectedUserId);
                // Broadcast updated doctor list
                io.emit('doctors-online', Array.from(onlineUsers.entries())
                    .filter(([id, user]) => user.userType === 'doctor')
                    .map(([id, user]) => ({ id, name: user.userName, status: user.status }))
                );
            }
            
            // End any active calls involving this user
            callRooms.forEach((room, roomId) => {
                if (room.patientId === disconnectedUserId || room.doctorId === disconnectedUserId) {
                    io.to(roomId).emit('call-ended');
                    callRooms.delete(roomId);
                }
            });
        }
    });
});

// ---------------- Existing Routes ----------------

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
    res.json({ message: "Server is running", timestamp: new Date().toISOString() });
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});