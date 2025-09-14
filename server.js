    require('dotenv').config();
    const mongoose = require("mongoose");
    const express = require("express");
    const bodyParser = require("body-parser");
    const cors = require("cors");
    const bcrypt = require('bcrypt');
    const http = require('http');
    const socketIo = require('socket.io');

    const Patient = require("./models/Patient");
    const Doctor = require("./models/Doctor");

    // Connect to MongoDB using environment variable
    const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://tradeabhiyt_db_user:KDHHiZHhRsRrD6fN@aihealthmatecluster.ryau30r.mongodb.net/?retryWrites=true&w=majority&appName=AIHealthMateCluster";

    if (!MONGO_URI) {
        console.error("ERROR: MONGO_URI not found in environment variables");
        process.exit(1);
    }

    mongoose.connect(MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
    .then(() => console.log("MongoDB connected successfully"))
    .catch(err => {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    });

    const app = express();
    const server = http.createServer(app);

    // Get the frontend URL from environment or default for development
    const FRONTEND_URL = process.env.FRONTEND_URL || 'https://abhijeet096.github.io';

    // Enhanced CORS configuration for production deployment
    const corsOptions = {
        origin: [
            FRONTEND_URL,
            'https://abhijeet096.github.io',
            'http://localhost:3000',
            'http://localhost:5173',
            /^https:\/\/.*\.render\.com$/,  // Allow any render.com subdomain
            /^https:\/\/.*\.github\.io$/,   // Allow GitHub Pages
        ],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
        credentials: true
    };

    // Apply CORS middleware
    app.use(cors(corsOptions));

    // Handle preflight requests
    app.options('*', cors(corsOptions));

    // Socket.IO configuration with proper CORS for production
    const io = socketIo(server, {
        cors: corsOptions,
        allowEIO3: true,
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000
    });

    const PORT = process.env.PORT || 5000;

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    // Add security headers
    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', req.headers.origin);
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization');
        
        if (req.method === 'OPTIONS') {
            res.sendStatus(200);
        } else {
            next();
        }
    });

    // Add a basic route for health checks
    app.get('/', (req, res) => {
        res.json({ 
            message: 'AI Health Mate Server is running!', 
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    });

    // Store online users and call requests - using Maps for better cross-device tracking
    const onlineUsers = new Map(); // userId -> socket info
    const onlineDoctors = new Map(); // doctorId -> doctor info
    const onlinePatients = new Map(); // patientId -> patient info
    const activeCallRequests = new Map(); // requestId -> call info
    const activeCalls = new Map(); // roomId -> call info

    // Debug logging helper
    function logState() {
        if (process.env.NODE_ENV !== 'production') {
            console.log('\n=== CURRENT STATE ===');
            console.log('Online Doctors:', Array.from(onlineDoctors.entries()).map(([id, doc]) => ({
                id,
                name: doc.name,
                socketId: doc.socketId.substring(0, 8) + '...'
            })));
            console.log('Online Patients:', Array.from(onlinePatients.entries()).map(([id, patient]) => ({
                id,
                name: patient.name,
                socketId: patient.socketId.substring(0, 8) + '...'
            })));
            console.log('Active Call Requests:', Array.from(activeCallRequests.entries()).map(([id, req]) => ({
                requestId: id,
                patient: req.patientName,
                status: req.status
            })));
            console.log('====================\n');
        }
    }

    // ---------------- Socket.IO Events ----------------
    io.on('connection', (socket) => {
        console.log(`New connection: ${socket.id}`);

        // User joins (patient or doctor)
        socket.on('join-as-user', (data) => {
            const { userId, userType, userName } = data;
            
            console.log(`User joining: ${userName} (${userType}) with ID: ${userId} from socket: ${socket.id}`);
            
            // Remove any existing connections for this user (handle reconnections)
            if (userType === 'doctor') {
                // Remove old doctor connection if exists
                const existingDoctor = onlineDoctors.get(userId);
                if (existingDoctor) {
                    console.log(`Removing existing doctor connection for ${userName}`);
                    onlineDoctors.delete(userId);
                }
            } else if (userType === 'patient') {
                // Remove old patient connection if exists
                const existingPatient = onlinePatients.get(userId);
                if (existingPatient) {
                    console.log(`Removing existing patient connection for ${userName}`);
                    onlinePatients.delete(userId);
                }
            }
            
            // Store user info
            onlineUsers.set(userId, {
                socketId: socket.id,
                userType,
                userName,
                status: 'online',
                joinedAt: Date.now()
            });

            socket.userId = userId;
            socket.userType = userType;
            socket.userName = userName;

            if (userType === 'doctor') {
                onlineDoctors.set(userId, {
                    id: userId,
                    name: userName,
                    status: 'online',
                    socketId: socket.id,
                    joinedAt: Date.now()
                });
                
                console.log(`Doctor ${userName} joined. Total online doctors: ${onlineDoctors.size}`);
                
                // Send waiting patients to this doctor
                const waitingPatients = Array.from(activeCallRequests.values())
                    .filter(req => req.status === 'waiting')
                    .map(req => ({
                        id: req.patientId,
                        name: req.patientName,
                        requestId: req.requestId,
                        timestamp: req.timestamp
                    }));
                
                socket.emit('waiting-patients', waitingPatients);
                console.log(`Sent ${waitingPatients.length} waiting patients to doctor ${userName}`);
                
            } else if (userType === 'patient') {
                onlinePatients.set(userId, {
                    id: userId,
                    name: userName,
                    socketId: socket.id,
                    joinedAt: Date.now()
                });
                
                console.log(`Patient ${userName} joined. Total online patients: ${onlinePatients.size}`);
            }

            // Always broadcast updated lists to ALL connected users
            broadcastOnlineDoctors();
            broadcastWaitingPatients();
            
            // Log current state in development
            logState();
            
            // Confirm join to the user
            socket.emit('join-confirmed', {
                userId,
                userType,
                userName,
                onlineDoctors: onlineDoctors.size,
                onlinePatients: onlinePatients.size
            });
        });

        // Patient requests video call
        socket.on('request-video-call', (data) => {
            const { patientId, patientName } = data;
            
            console.log(`VIDEO CALL REQUEST from: ${patientName} (${patientId})`);
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

            // Notify ALL online doctors about the call request
            let doctorsNotified = 0;
            let doctorsSkipped = 0;
            
            onlineDoctors.forEach((doctor, doctorId) => {
                const doctorSocket = io.sockets.sockets.get(doctor.socketId);
                if (doctorSocket && doctorSocket.connected) {
                    doctorSocket.emit('incoming-call-request', {
                        patientId,
                        patientName,
                        requestId
                    });
                    doctorsNotified++;
                } else {
                    console.log(`Dr. ${doctor.name} socket not connected, removing from list`);
                    onlineDoctors.delete(doctorId);
                    doctorsSkipped++;
                }
            });

            console.log(`Notification Results: ${doctorsNotified} notified, ${doctorsSkipped} skipped`);
            
            if (doctorsNotified === 0) {
                console.log('No doctors could be notified');
                socket.emit('call-rejected', {
                    doctorName: 'System',
                    message: 'No doctors available at the moment'
                });
                activeCallRequests.delete(requestId);
                return;
            }

            // Update waiting patients for all doctors
            broadcastWaitingPatients();
            
            // Auto-cancel request after 2 minutes
            setTimeout(() => {
                const request = activeCallRequests.get(requestId);
                if (request && request.status === 'waiting') {
                    console.log(`Auto-cancelling request ${requestId} after timeout`);
                    activeCallRequests.delete(requestId);
                    const patientSocket = io.sockets.sockets.get(request.patientSocketId);
                    if (patientSocket && patientSocket.connected) {
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
            
            console.log(`CALL ACCEPTANCE - Doctor: ${doctorName}, Patient: ${patientId}`);
            
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
            if (patientSocket && patientSocket.connected) {
                patientSocket.join(roomId);
                
                // Notify patient that call was accepted
                patientSocket.emit('call-accepted', {
                    roomId,
                    doctorName,
                    doctorId
                });
            } else {
                console.log('Patient socket not found or disconnected');
                socket.emit('call-failed', { message: 'Patient is no longer available' });
                activeCallRequests.delete(requestId);
                return;
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

            // Notify doctor that call started
            socket.emit('call-started', {
                roomId,
                patientId,
                patientName: requestToAccept.patientName
            });

            // Remove the request and notify other doctors
            activeCallRequests.delete(requestId);
            
            // Notify other doctors that this call was taken
            onlineDoctors.forEach((doctor, dId) => {
                if (dId !== doctorId) {
                    const doctorSocket = io.sockets.sockets.get(doctor.socketId);
                    if (doctorSocket && doctorSocket.connected) {
                        doctorSocket.emit('call-taken', { patientId });
                    }
                }
            });

            broadcastWaitingPatients();
            console.log(`Call successfully established: Dr. ${doctorName} <-> ${requestToAccept.patientName}`);
        });

        // Doctor rejects call
        socket.on('reject-call', (data) => {
            const { patientId, doctorId } = data;
            console.log(`Dr. ${socket.userName} rejected call from patient ${patientId}`);
            // Individual rejection - call request remains for other doctors
        });

        // WebRTC Signaling
        socket.on('webrtc-offer', (data) => {
            const { roomId, offer } = data;
            console.log(`WebRTC offer received for room ${roomId}`);
            socket.to(roomId).emit('webrtc-offer', {
                offer,
                from: socket.userId
            });
        });

        socket.on('webrtc-answer', (data) => {
            const { roomId, answer } = data;
            console.log(`WebRTC answer received for room ${roomId}`);
            socket.to(roomId).emit('webrtc-answer', {
                answer,
                from: socket.userId
            });
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
                console.log(`Call ended in room ${roomId}`);
                socket.to(roomId).emit('call-ended');
                activeCalls.delete(roomId);
            }
        });

        // Handle disconnect with enhanced cleanup
        socket.on('disconnect', (reason) => {
            console.log(`User disconnect: ${socket.id}, reason: ${reason}`);
            
            if (socket.userId) {
                // Remove from online users
                onlineUsers.delete(socket.userId);
                
                if (socket.userType === 'doctor') {
                    const removed = onlineDoctors.delete(socket.userId);
                    console.log(`Doctor removed: ${removed}. Remaining doctors: ${onlineDoctors.size}`);
                    broadcastOnlineDoctors();
                    
                } else if (socket.userType === 'patient') {
                    const removed = onlinePatients.delete(socket.userId);
                    console.log(`Patient removed: ${removed}. Remaining patients: ${onlinePatients.size}`);
                    
                    // Cancel any active call requests from this patient
                    for (const [requestId, request] of activeCallRequests.entries()) {
                        if (request.patientId === socket.userId) {
                            console.log(`Cancelling call request ${requestId}`);
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

    // Enhanced broadcast functions
    function broadcastOnlineDoctors() {
        const doctorsList = Array.from(onlineDoctors.values()).map(doctor => ({
            id: doctor.id,
            name: doctor.name,
            status: doctor.status,
            specialty: doctor.specialty || 'General'
        }));
        
        onlinePatients.forEach((patient, patientId) => {
            const patientSocket = io.sockets.sockets.get(patient.socketId);
            if (patientSocket && patientSocket.connected) {
                patientSocket.emit('doctors-online', doctorsList);
            } else {
                onlinePatients.delete(patientId);
            }
        });
    }

    function broadcastWaitingPatients() {
        const waitingPatients = Array.from(activeCallRequests.values())
            .filter(req => req.status === 'waiting')
            .map(req => ({
                id: req.patientId,
                name: req.patientName,
                requestId: req.requestId,
                timestamp: req.timestamp
            }));
        
        onlineDoctors.forEach((doctor, doctorId) => {
            const doctorSocket = io.sockets.sockets.get(doctor.socketId);
            if (doctorSocket && doctorSocket.connected) {
                doctorSocket.emit('waiting-patients', waitingPatients);
            } else {
                onlineDoctors.delete(doctorId);
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

    // Enhanced health check endpoint
    app.get("/api/health", (req, res) => {
        const connectedSockets = io.sockets.sockets.size;
        res.json({ 
            message: "Server is running", 
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            connectedSockets: connectedSockets,
            onlineDoctors: onlineDoctors.size,
            onlinePatients: onlinePatients.size,
            activeCalls: activeCalls.size,
            activeRequests: activeCallRequests.size
        });
    });

    // Debug endpoint (only in non-production)
    if (process.env.NODE_ENV !== 'production') {
        app.get("/api/debug", (req, res) => {
            res.json({
                timestamp: new Date().toISOString(),
                server: {
                    connectedSockets: io.sockets.sockets.size,
                    onlineDoctors: onlineDoctors.size,
                    onlinePatients: onlinePatients.size
                },
                doctors: Array.from(onlineDoctors.entries()).map(([id, doc]) => ({
                    id,
                    name: doc.name,
                    socketId: doc.socketId,
                    joinedAt: new Date(doc.joinedAt).toISOString()
                })),
                patients: Array.from(onlinePatients.entries()).map(([id, patient]) => ({
                    id,
                    name: patient.name,
                    socketId: patient.socketId,
                    joinedAt: new Date(patient.joinedAt).toISOString()
                })),
                activeRequests: Array.from(activeCallRequests.entries()).map(([id, req]) => ({
                    requestId: id,
                    patientName: req.patientName,
                    status: req.status,
                    timestamp: new Date(req.timestamp).toISOString()
                }))
            });
        });
    }

    // Error handling middleware
    app.use((err, req, res, next) => {
        console.error('Error:', err);
        res.status(500).json({ 
            message: 'Internal server error',
            ...(process.env.NODE_ENV !== 'production' && { error: err.message })
        });
    });

    // 404 handler
    app.use('*', (req, res) => {
        res.status(404).json({ message: 'Route not found' });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('SIGTERM received, shutting down gracefully');
        server.close(() => {
            console.log('Process terminated');
            mongoose.connection.close(false, () => {
                console.log('MongoDB connection closed');
                process.exit(0);
            });
        });
    });

    // Start server
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
    server.listen(PORT, host, () => {
        console.log(`🚀 Server running on ${host}:${PORT}`);
        console.log(`🏥 Health check: http://${host}:${PORT}/api/health`);
        console.log(`🔌 Socket.IO server initialized with CORS enabled`);
        console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log('==========================================');
    });
