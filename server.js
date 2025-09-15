const mongoose = require("mongoose");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require('bcrypt');
const http = require('http');
const socketIo = require('socket.io');
const OpenAI = require('openai');
require('dotenv').config();

const Patient = require("./models/Patient");
const Doctor = require("./models/Doctor");

// Initialize OpenAI with environment variable
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Validate required environment variables
if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is not set in environment variables');
    console.error('Please add OPENAI_API_KEY=your_api_key_here to your .env file');
    process.exit(1);
}

// Connect to MongoDB using environment variable
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/aihealthmate";

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.log("MongoDB connection error:", err));

const app = express();
const server = http.createServer(app);

// Enhanced CORS configuration for cross-device communication
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins for development
        methods: ["GET", "POST"],
        allowedHeaders: ["*"],
        credentials: true
    },
    allowEIO3: true,
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 5000;

// Enhanced CORS middleware
app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

app.use(bodyParser.json());

// Store online users, call requests, and chat sessions
const onlineUsers = new Map();
const onlineDoctors = new Map();
const onlinePatients = new Map();
const activeCallRequests = new Map();
const activeCalls = new Map();

// NEW: Chat session storage for medical consultations
const chatSessions = new Map(); // sessionId -> chat data
const pendingPrescriptions = new Map(); // prescriptionId -> prescription data

// Medical consultation flow configuration
const MEDICAL_QUESTIONS = {
    fever: [
        "How long have you been experiencing fever?",
        "What is your current body temperature?",
        "Are you taking any fever-reducing medication?",
        "Do you have any other symptoms like chills, headache, or body aches?"
    ],
    headache: [
        "How long have you been experiencing headaches?",
        "On a scale of 1-10, how would you rate your pain?",
        "Is this a throbbing, sharp, or dull pain?",
        "Are you experiencing any visual disturbances or nausea?"
    ],
    cough: [
        "How long have you had this cough?",
        "Is it a dry cough or are you coughing up phlegm?",
        "Do you have any chest pain or difficulty breathing?",
        "Are you a smoker or have you been around smoke recently?"
    ],
    "stomach pain": [
        "How long have you been experiencing stomach pain?",
        "Where exactly is the pain located?",
        "Is the pain constant or does it come and go?",
        "Have you noticed any changes in your bowel movements or appetite?"
    ],
    "chest pain": [
        "How long have you been experiencing chest pain?",
        "On a scale of 1-10, how severe is the pain?",
        "Does the pain worsen with breathing or movement?",
        "Are you experiencing shortness of breath or palpitations?"
    ],
    default: [
        "Can you describe your symptoms in more detail?",
        "When did these symptoms start?",
        "Have you experienced anything like this before?",
        "Are you currently taking any medications?"
    ]
};

// Predefined prescriptions for fallback
const PREDEFINED_PRESCRIPTIONS = {
    fever: `
Patient Symptoms Summary: Fever with possible associated symptoms.
Preliminary AI Diagnosis: Likely viral infection or common cold.
Suggested Medications: 
- Paracetamol 500mg every 6-8 hours as needed for fever.
- Ibuprofen 400mg every 8 hours if inflammation present.
Care Instructions: Rest, stay hydrated, monitor temperature.
Duration of Treatment: 3-5 days.
Follow-up Recommendations: If fever persists beyond 3 days or worsens, consult a doctor immediately.
Disclaimer: This is not a substitute for professional medical advice.`,
    headache: `
Patient Symptoms Summary: Headache with possible associated pain levels.
Preliminary AI Diagnosis: Possible tension headache or migraine.
Suggested Medications: 
- Acetaminophen 650mg every 6 hours.
- Sumatriptan 50mg if migraine suspected.
Care Instructions: Avoid triggers, rest in dark room, hydrate.
Duration of Treatment: As needed, up to 3 days.
Follow-up Recommendations: If persistent or severe, seek medical attention.`,
    cough: `
Patient Symptoms Summary: Cough with possible phlegm or breathing issues.
Preliminary AI Diagnosis: Possible upper respiratory infection.
Suggested Medications: 
- Dextromethorphan syrup 15mg every 6 hours for dry cough.
- Guaifenesin 400mg every 4 hours if productive.
Care Instructions: Stay hydrated, use humidifier, avoid smoke.
Duration of Treatment: 5-7 days.
Follow-up Recommendations: If shortness of breath, see doctor urgently.`,
    "stomach pain": `
Patient Symptoms Summary: Stomach pain with possible digestive changes.
Preliminary AI Diagnosis: Possible gastritis or indigestion.
Suggested Medications: 
- Antacid (e.g., Maalox) 15ml every 4 hours.
- Omeprazole 20mg once daily.
Care Instructions: Eat small meals, avoid spicy foods.
Duration of Treatment: 7 days.
Follow-up Recommendations: If pain worsens or vomiting occurs, consult doctor.`,
    "chest pain": `
Patient Symptoms Summary: Chest pain with possible breathing issues.
Preliminary AI Diagnosis: Possible musculoskeletal pain or anxiety-related.
Suggested Medications: 
- Ibuprofen 400mg every 8 hours.
- If anxiety, consider relaxation techniques.
Care Instructions: Rest, monitor symptoms closely.
Duration of Treatment: 3 days.
Follow-up Recommendations: Immediate medical attention if pain radiates or worsens.`,
    default: `
Patient Symptoms Summary: General symptoms described.
Preliminary AI Diagnosis: Undetermined - requires further assessment.
Suggested Medications: 
- Over-the-counter pain reliever as needed.
Care Instructions: Rest and monitor symptoms.
Duration of Treatment: Until symptoms resolve.
Follow-up Recommendations: Consult a healthcare professional promptly.`
};

// Medical AI System Prompt
const MEDICAL_SYSTEM_PROMPT = `You are Dr. AI, a professional medical AI assistant for initial symptom assessment. Your role is to:

1. ALWAYS ask follow-up questions to gather more information about symptoms
2. Be empathetic and professional in your responses
3. Ask one question at a time to avoid overwhelming the patient
4. When you have enough information (after 3-4 exchanges), provide a preliminary assessment
5. ALWAYS remind patients that this is not a substitute for professional medical advice
6. If symptoms seem serious, recommend immediate medical attention

Guidelines:
- Ask about duration, severity, and associated symptoms
- Inquire about medical history and current medications when relevant
- Use simple, clear language
- Never provide definitive diagnoses
- Always suggest consulting with a healthcare professional for proper treatment

Current conversation context: The patient has described their initial symptoms. Ask appropriate follow-up questions to gather more information.`;

// Debug logging helper
function logState() {
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
    console.log('Active Chat Sessions:', chatSessions.size);
    console.log('Pending Prescriptions:', pendingPrescriptions.size);
    console.log('====================\n');
}

// Fallback rule-based response generator
function getRuleBasedResponse(session, userMessage) {
    if (!session.currentSymptom) {
        // Detect symptom from user message
        const lowerMessage = userMessage.toLowerCase();
        let detectedSymptom = 'default';
        Object.keys(MEDICAL_QUESTIONS).forEach(key => {
            if (lowerMessage.includes(key)) {
                detectedSymptom = key;
            }
        });
        session.currentSymptom = detectedSymptom;
        session.questionIndex = 0;
        session.answers = [];
    }

    if (session.questionIndex < MEDICAL_QUESTIONS[session.currentSymptom].length) {
        const question = MEDICAL_QUESTIONS[session.currentSymptom][session.questionIndex];
        session.questionIndex++;
        return `Thank you for sharing. ${question} Remember, this is for initial assessment only - please consult a doctor for proper diagnosis.`;
    } else {
        // Enough questions asked, provide assessment
        session.messageCount += 2; // Simulate
        if (!session.prescriptionGenerated) {
            setTimeout(() => generateMedicalPrescription(session.sessionId, true), 2000); // Use fallback
            session.prescriptionGenerated = true;
        }
        return "Based on your responses, I've gathered enough information for a preliminary assessment. I'll prepare a treatment suggestion shortly, which will be reviewed by a doctor. In the meantime, if symptoms worsen, seek immediate medical help.";
    }
}

// Fallback rule-based prescription
function getRuleBasedPrescription(session) {
    const symptom = session.currentSymptom || 'default';
    return PREDEFINED_PRESCRIPTIONS[symptom];
}

// AI Chat Helper Functions
async function generateAIResponse(sessionId, userMessage, chatHistory) {
    try {
        const session = chatSessions.get(sessionId);
        if (!session) {
            console.error('Session not found:', sessionId);
            return "I apologize, but I couldn't find your session. Please start a new consultation.";
        }

        // Build conversation context
        const messages = [
            { role: 'system', content: MEDICAL_SYSTEM_PROMPT },
            ...chatHistory.map(msg => ({
                role: msg.sender === 'ai' ? 'assistant' : 'user',
                content: msg.content
            })),
            { role: 'user', content: userMessage }
        ];

        console.log(`🤖 Generating AI response for session ${sessionId}`);
        console.log(`📝 Message count: ${messages.length}`);

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: messages,
            max_tokens: 300,
            temperature: 0.7,
        });

        const aiResponse = completion.choices[0].message.content.trim();
        console.log(`✅ AI Response generated: ${aiResponse.substring(0, 100)}...`);

        // Update session
        session.messageCount += 2; // user message + AI response
        session.lastActivity = Date.now();

        // Check if we should generate prescription (after 6+ messages)
        if (session.messageCount >= 6 && !session.prescriptionGenerated) {
            console.log(`📋 Preparing to generate prescription for session ${sessionId}`);
            setTimeout(() => generateMedicalPrescription(sessionId), 2000);
            session.prescriptionGenerated = true;
        }

        return aiResponse;

    } catch (error) {
        console.error('OpenAI API Error:', error);
        
        // Fallback to rule-based
        const session = chatSessions.get(sessionId);
        if (session) {
            const fallbackResponse = getRuleBasedResponse(session, userMessage);
            session.messageCount += 2;
            session.lastActivity = Date.now();
            if (session.messageCount >= 6 && !session.prescriptionGenerated) {
                setTimeout(() => generateMedicalPrescription(sessionId, true), 2000); // Fallback mode
                session.prescriptionGenerated = true;
            }
            return fallbackResponse;
        }
        
        // General fallback responses
        if (error.code === 'insufficient_quota' || error.status === 429) {
            return "I apologize, but I'm experiencing high demand right now. Please try again in a moment, or consider connecting with one of our available doctors for immediate assistance.";
        }
        
        return "I apologize, but I'm having trouble processing your request right now. Please try rephrasing your symptoms, or connect with one of our available doctors for assistance.";
    }
}

async function generateMedicalPrescription(sessionId, useFallback = false) {
    try {
        const session = chatSessions.get(sessionId);
        if (!session || !session.chatHistory || session.chatHistory.length < 4) {
            console.log(`❌ Cannot generate prescription: insufficient data for session ${sessionId}`);
            return;
        }

        console.log(`📋 Generating medical prescription for session ${sessionId}`);

        let prescriptionContent;
        if (useFallback) {
            prescriptionContent = getRuleBasedPrescription(session);
        } else {
            // Create conversation summary for prescription
            const conversationSummary = session.chatHistory
                .map(msg => `${msg.sender.toUpperCase()}: ${msg.content}`)
                .join('\n');

            const prescriptionPrompt = `Based on the following medical consultation, generate a detailed medical prescription format. Include preliminary diagnosis, recommended medications (with dosages), and general care instructions. Remember this is AI-suggested and requires doctor approval.

Consultation Summary:
${conversationSummary}

Generate a professional medical prescription format with:
1. Patient symptoms summary
2. Preliminary AI diagnosis
3. Suggested medications with dosages
4. Care instructions
5. Duration of treatment
6. Follow-up recommendations

Format as a structured prescription that a doctor can review and approve.`;

            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { 
                        role: 'system', 
                        content: 'You are a medical AI creating prescription suggestions for doctor review. Be thorough, professional, and include appropriate disclaimers.' 
                    },
                    { role: 'user', content: prescriptionPrompt }
                ],
                max_tokens: 500,
                temperature: 0.3,
            });

            prescriptionContent = completion.choices[0].message.content.trim();
        }
        
        // Create prescription record
        const prescriptionId = `presc_${sessionId}_${Date.now()}`;
        const prescriptionData = {
            id: prescriptionId,
            patientId: session.patientId,
            patientName: session.patientName,
            sessionId: sessionId,
            content: prescriptionContent,
            status: 'pending_approval',
            createdAt: Date.now(),
            aiGenerated: true,
            conversationSummary: session.chatHistory.map(msg => `${msg.sender.toUpperCase()}: ${msg.content}`).join('\n')
        };

        pendingPrescriptions.set(prescriptionId, prescriptionData);

        // Notify patient about prescription generation
        const patientSocket = io.sockets.sockets.get(session.socketId);
        if (patientSocket && patientSocket.connected) {
            patientSocket.emit('prescription-generated', {
                prescriptionId,
                message: "Based on our consultation, I've generated a preliminary treatment plan that has been sent to our doctors for review and approval."
            });
            console.log(`✅ Notified patient about generated prescription ${prescriptionId}`);
        }

        // Send prescription to the most recently active doctor
        const recentDoctor = findMostRecentDoctor();
        if (recentDoctor) {
            const doctorSocket = io.sockets.sockets.get(recentDoctor.socketId);
            if (doctorSocket && doctorSocket.connected) {
                doctorSocket.emit('new-prescription-approval', prescriptionData);
                console.log(`✅ Sent prescription ${prescriptionId} to Dr. ${recentDoctor.name} for approval`);
            }
        } else {
            console.log(`⚠️ No active doctors found to send prescription ${prescriptionId}`);
        }

        // Broadcast to all online doctors
        broadcastPrescriptionToAllDoctors(prescriptionData);

        console.log(`✅ Prescription ${prescriptionId} generated and queued for approval`);

    } catch (error) {
        console.error('Error generating prescription:', error);
        // If not fallback and error, retry with fallback
        if (!useFallback) {
            generateMedicalPrescription(sessionId, true);
        }
    }
}

function findMostRecentDoctor() {
    let mostRecent = null;
    let latestTime = 0;

    onlineDoctors.forEach((doctor, doctorId) => {
        if (doctor.joinedAt > latestTime) {
            latestTime = doctor.joinedAt;
            mostRecent = doctor;
        }
    });

    return mostRecent;
}

function broadcastPrescriptionToAllDoctors(prescriptionData) {
    let notifiedDoctors = 0;
    
    onlineDoctors.forEach((doctor, doctorId) => {
        const doctorSocket = io.sockets.sockets.get(doctor.socketId);
        if (doctorSocket && doctorSocket.connected) {
            doctorSocket.emit('new-prescription-approval', prescriptionData);
            notifiedDoctors++;
        }
    });

    console.log(`📢 Prescription ${prescriptionData.id} broadcasted to ${notifiedDoctors} doctors`);
}

// ---------------- Socket.IO Events ----------------
io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id} from ${socket.handshake.address}`);

    // User joins (patient or doctor)
    socket.on('join-as-user', (data) => {
        const { userId, userType, userName } = data;
        
        console.log(`User joining: ${userName} (${userType}) with ID: ${userId} from socket: ${socket.id}`);
        
        // Remove any existing connections for this user (handle reconnections)
        if (userType === 'doctor') {
            const existingDoctor = onlineDoctors.get(userId);
            if (existingDoctor) {
                console.log(`Removing existing doctor connection for ${userName}`);
                onlineDoctors.delete(userId);
            }
        } else if (userType === 'patient') {
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
            
            // Send pending prescriptions to doctor
            const pendingPrescriptionsForDoctor = Array.from(pendingPrescriptions.values())
                .filter(presc => presc.status === 'pending_approval');
            
            if (pendingPrescriptionsForDoctor.length > 0) {
                socket.emit('pending-prescriptions-list', pendingPrescriptionsForDoctor);
                console.log(`Sent ${pendingPrescriptionsForDoctor.length} pending prescriptions to Dr. ${userName}`);
            }
            
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
        
        // Log current state
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

    // NEW: Start AI Chat Session
    socket.on('start-ai-chat', (data) => {
        const { patientId, patientName } = data;
        const sessionId = `chat_${patientId}_${Date.now()}`;
        
        console.log(`🤖 Starting AI chat session ${sessionId} for patient ${patientName}`);
        
        const chatSession = {
            sessionId,
            patientId,
            patientName,
            socketId: socket.id,
            chatHistory: [],
            messageCount: 0,
            startTime: Date.now(),
            lastActivity: Date.now(),
            prescriptionGenerated: false,
            currentSymptom: null,
            questionIndex: 0,
            answers: []
        };
        
        chatSessions.set(sessionId, chatSession);
        
        socket.emit('ai-chat-started', { 
            sessionId,
            message: "Hello! I'm Dr. AI, your medical assistant. I'm here to help assess your symptoms. Please describe what you're experiencing, and I'll ask some follow-up questions to better understand your condition."
        });
        
        console.log(`✅ AI chat session started: ${sessionId}`);
    });

    // NEW: Handle AI Chat Messages
    socket.on('ai-chat-message', async (data) => {
        const { sessionId, message, patientId } = data;
        
        console.log(`💬 AI Chat message received from session ${sessionId}: ${message.substring(0, 50)}...`);
        
        const session = chatSessions.get(sessionId);
        if (!session) {
            socket.emit('ai-chat-error', { message: 'Chat session not found. Please start a new consultation.' });
            return;
        }

        // Add user message to history
        const userMessage = {
            sender: 'user',
            content: message,
            timestamp: Date.now()
        };
        session.chatHistory.push(userMessage);
        session.answers.push(message); // For fallback

        // Generate AI response
        const aiResponse = await generateAIResponse(sessionId, message, session.chatHistory);
        
        // Add AI response to history
        const aiMessage = {
            sender: 'ai',
            content: aiResponse,
            timestamp: Date.now()
        };
        session.chatHistory.push(aiMessage);

        // Send response to patient
        socket.emit('ai-chat-response', {
            message: aiResponse,
            sessionId: sessionId
        });

        console.log(`✅ AI response sent for session ${sessionId}`);
    });

    // NEW: Doctor prescription approval/rejection
    socket.on('approve-prescription', (data) => {
        const { prescriptionId, doctorId, doctorName, modifications } = data;
        
        console.log(`👨‍⚕️ Dr. ${doctorName} approving prescription ${prescriptionId}`);
        
        const prescription = pendingPrescriptions.get(prescriptionId);
        if (!prescription) {
            socket.emit('prescription-error', { message: 'Prescription not found' });
            return;
        }

        prescription.status = 'approved';
        prescription.approvedBy = doctorId;
        prescription.approvedByName = doctorName;
        prescription.approvedAt = Date.now();
        
        if (modifications) {
            prescription.modifications = modifications;
            prescription.finalContent = modifications;
        } else {
            prescription.finalContent = prescription.content;
        }

        // Notify patient
        const patientSocketActual = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === prescription.patientId);
        
        if (patientSocketActual) {
            patientSocketActual.emit('prescription-approved', {
                prescriptionId,
                doctorName,
                content: prescription.finalContent,
                message: `Your prescription has been approved by Dr. ${doctorName}. You can now download it from your dashboard.`
            });
        }

        socket.emit('prescription-approved-confirm', { prescriptionId });
        console.log(`✅ Prescription ${prescriptionId} approved by Dr. ${doctorName}`);
    });

    socket.on('reject-prescription', (data) => {
        const { prescriptionId, doctorId, doctorName, reason } = data;
        
        console.log(`👨‍⚕️ Dr. ${doctorName} rejecting prescription ${prescriptionId}`);
        
        const prescription = pendingPrescriptions.get(prescriptionId);
        if (!prescription) {
            socket.emit('prescription-error', { message: 'Prescription not found' });
            return;
        }

        prescription.status = 'rejected';
        prescription.rejectedBy = doctorId;
        prescription.rejectedByName = doctorName;
        prescription.rejectedAt = Date.now();
        prescription.rejectionReason = reason;

        // Notify patient
        const patientSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.userId === prescription.patientId);
        
        if (patientSocket) {
            patientSocket.emit('prescription-rejected', {
                prescriptionId,
                doctorName,
                reason,
                message: `Your prescription was reviewed by Dr. ${doctorName}. Please consult with a doctor directly for further assistance.`
            });
        }

        socket.emit('prescription-rejected-confirm', { prescriptionId });
        console.log(`❌ Prescription ${prescriptionId} rejected by Dr. ${doctorName}`);
    });

    // Patient requests video call
    socket.on('request-video-call', (data) => {
        const { patientId, patientName } = data;
        
        console.log(`\n=== VIDEO CALL REQUEST ===`);
        console.log(`From: ${patientName} (${patientId})`);
        console.log(`Available doctors: ${onlineDoctors.size}`);
        
        if (onlineDoctors.size === 0) {
            console.log('❌ No doctors online, rejecting call');
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
        console.log(`✅ Call request created: ${requestId}`);

        // Notify ALL online doctors about the call request
        let doctorsNotified = 0;
        
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
                onlineDoctors.delete(doctorId);
            }
        });

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
        }, 120000);
    });

    // Doctor accepts call
    socket.on('accept-call', (data) => {
        const { patientId, doctorId, doctorName } = data;
        
        console.log(`\n=== CALL ACCEPTANCE ===`);
        console.log(`Doctor: ${doctorName} (${doctorId})`);
        console.log(`Patient: ${patientId}`);
        
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
            socket.emit('call-taken', { patientId });
            return;
        }

        // Mark request as accepted and create call room
        requestToAccept.status = 'accepted';
        requestToAccept.doctorId = doctorId;
        requestToAccept.doctorName = doctorName;
        requestToAccept.doctorSocketId = socket.id;

        const roomId = `room_${patientId}_${doctorId}_${Date.now()}`;
        
        socket.join(roomId);
        const patientSocket = io.sockets.sockets.get(requestToAccept.patientSocketId);
        if (patientSocket && patientSocket.connected) {
            patientSocket.join(roomId);
            patientSocket.emit('call-accepted', {
                roomId,
                doctorName,
                doctorId
            });
        } else {
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

        socket.emit('call-started', {
            roomId,
            patientId,
            patientName: requestToAccept.patientName
        });

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
    });

    // WebRTC Signaling
    socket.on('webrtc-offer', (data) => {
        const { roomId, offer } = data;
        socket.to(roomId).emit('webrtc-offer', {
            offer,
            from: socket.userId
        });
    });

    socket.on('webrtc-answer', (data) => {
        const { roomId, answer } = data;
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
            socket.to(roomId).emit('call-ended');
            activeCalls.delete(roomId);
        }
    });

    // Handle disconnect with enhanced cleanup
    socket.on('disconnect', (reason) => {
        console.log(`\n=== USER DISCONNECT ===`);
        console.log(`Socket: ${socket.id}`);
        console.log(`Reason: ${reason}`);
        
        if (socket.userId) {
            console.log(`User: ${socket.userName} (${socket.userType})`);
            
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
                        activeCallRequests.delete(requestId);
                    }
                }
                
                // Clean up chat sessions
                for (const [sessionId, session] of chatSessions.entries()) {
                    if (session.patientId === socket.userId) {
                        console.log(`🗑️ Cleaning up chat session ${sessionId}`);
                        chatSessions.delete(sessionId);
                    }
                }
                
                broadcastWaitingPatients();
            }

            // End any active calls this user was in
            for (const [roomId, call] of activeCalls.entries()) {
                if (call.patientId === socket.userId || call.doctorId === socket.userId) {
                    socket.to(roomId).emit('call-ended');
                    activeCalls.delete(roomId);
                }
            }
        }
        
        logState();
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
    
    console.log(`📢 Broadcasting ${doctorsList.length} online doctors to ${onlinePatients.size} patients`);
    
    let patientsNotified = 0;
    
    onlinePatients.forEach((patient, patientId) => {
        const patientSocket = io.sockets.sockets.get(patient.socketId);
        if (patientSocket && patientSocket.connected) {
            patientSocket.emit('doctors-online', doctorsList);
            patientsNotified++;
        } else {
            console.log(`⚠️ Patient ${patient.name} socket disconnected, removing from list`);
            onlinePatients.delete(patientId);
        }
    });
    
    console.log(`📊 Doctor list broadcast: ${patientsNotified} patients notified`);
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
    
    console.log(`📢 Broadcasting ${waitingPatients.length} waiting patients to ${onlineDoctors.size} doctors`);
    
    let doctorsNotified = 0;
    
    onlineDoctors.forEach((doctor, doctorId) => {
        const doctorSocket = io.sockets.sockets.get(doctor.socketId);
        if (doctorSocket && doctorSocket.connected) {
            doctorSocket.emit('waiting-patients', waitingPatients);
            doctorsNotified++;
        } else {
            console.log(`⚠️ Doctor ${doctor.name} socket disconnected, removing from list`);
            onlineDoctors.delete(doctorId);
        }
    });
    
    console.log(`📊 Waiting patients broadcast: ${doctorsNotified} doctors notified`);
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

// NEW: AI Chat endpoint for REST API access
app.post("/api/ai-chat", async (req, res) => {
    const { message, sessionId, patientId, patientName } = req.body;

    if (!message) {
        return res.status(400).json({ message: "Message is required" });
    }

    try {
        let session = chatSessions.get(sessionId);
        
        // Create new session if doesn't exist
        if (!session && patientId && patientName) {
            const newSessionId = sessionId || `chat_${patientId}_${Date.now()}`;
            session = {
                sessionId: newSessionId,
                patientId,
                patientName,
                chatHistory: [],
                messageCount: 0,
                startTime: Date.now(),
                lastActivity: Date.now(),
                prescriptionGenerated: false,
                currentSymptom: null,
                questionIndex: 0,
                answers: []
            };
            chatSessions.set(newSessionId, session);
        }

        if (!session) {
            return res.status(400).json({ message: "Session not found and insufficient data to create new session" });
        }

        // Generate AI response
        const aiResponse = await generateAIResponse(session.sessionId, message, session.chatHistory);
        
        // Update session history
        session.chatHistory.push(
            { sender: 'user', content: message, timestamp: Date.now() },
            { sender: 'ai', content: aiResponse, timestamp: Date.now() }
        );
        session.answers.push(message);

        res.json({
            sessionId: session.sessionId,
            aiResponse,
            messageCount: session.messageCount
        });

    } catch (error) {
        console.error("AI Chat API error:", error);
        res.status(500).json({ message: "Error processing AI chat request" });
    }
});

// NEW: Get prescription details
app.get("/api/prescription/:prescriptionId", (req, res) => {
    const { prescriptionId } = req.params;
    const prescription = pendingPrescriptions.get(prescriptionId);
    
    if (!prescription) {
        return res.status(404).json({ message: "Prescription not found" });
    }

    res.json(prescription);
});

// NEW: Get all prescriptions for a patient
app.get("/api/prescriptions/patient/:patientId", (req, res) => {
    const { patientId } = req.params;
    
    const patientPrescriptions = Array.from(pendingPrescriptions.values())
        .filter(presc => presc.patientId === patientId);
    
    res.json(patientPrescriptions);
});

// NEW: Get pending prescriptions for doctors
app.get("/api/prescriptions/pending", (req, res) => {
    const pendingPrescriptionsList = Array.from(pendingPrescriptions.values())
        .filter(presc => presc.status === 'pending_approval');
    
    res.json(pendingPrescriptionsList);
});

// Enhanced health check endpoint
app.get("/api/health", (req, res) => {
    const connectedSockets = io.sockets.sockets.size;
    res.json({ 
        message: "Server is running with AI integration", 
        timestamp: new Date().toISOString(),
        connectedSockets: connectedSockets,
        onlineDoctors: onlineDoctors.size,
        onlinePatients: onlinePatients.size,
        activeCalls: activeCalls.size,
        activeRequests: activeCallRequests.size,
        activeChatSessions: chatSessions.size,
        pendingPrescriptions: pendingPrescriptions.size,
        doctorsList: Array.from(onlineDoctors.values()).map(d => ({
            id: d.id,
            name: d.name,
            socketId: d.socketId.substring(0, 8) + '...'
        })),
        patientsList: Array.from(onlinePatients.values()).map(p => ({
            id: p.id,
            name: p.name,
            socketId: p.socketId.substring(0, 8) + '...'
        }))
    });
});

// Enhanced debug endpoint
app.get("/api/debug", (req, res) => {
    res.json({
        timestamp: new Date().toISOString(),
        server: {
            connectedSockets: io.sockets.sockets.size,
            onlineDoctors: onlineDoctors.size,
            onlinePatients: onlinePatients.size,
            activeChatSessions: chatSessions.size,
            pendingPrescriptions: pendingPrescriptions.size
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
        })),
        chatSessions: Array.from(chatSessions.entries()).map(([id, session]) => ({
            sessionId: id,
            patientName: session.patientName,
            messageCount: session.messageCount,
            startTime: new Date(session.startTime).toISOString(),
            prescriptionGenerated: session.prescriptionGenerated
        })),
        prescriptions: Array.from(pendingPrescriptions.entries()).map(([id, presc]) => ({
            prescriptionId: id,
            patientName: presc.patientName,
            status: presc.status,
            createdAt: new Date(presc.createdAt).toISOString()
        }))
    });
});

// NEW: Test OpenAI connection
app.get("/api/test-ai", async (req, res) => {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful medical AI assistant." },
                { role: "user", content: "Say hello and confirm you're working properly." }
            ],
            max_tokens: 50,
            temperature: 0.7,
        });

        const response = completion.choices[0].message.content;
        
        res.json({
            success: true,
            message: "OpenAI connection successful",
            aiResponse: response,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("OpenAI test error:", error);
        res.status(500).json({
            success: false,
            message: "OpenAI connection failed",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Start server with enhanced logging
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🛠 Debug endpoint: http://localhost:${PORT}/api/debug`);
    console.log(`🤖 AI test endpoint: http://localhost:${PORT}/api/test-ai`);
    console.log(`🔌 Socket.IO server initialized with CORS enabled`);
    console.log(`🧠 OpenAI integration enabled for medical consultation`);
    console.log(`📱 Server accessible from other devices on your network`);
    console.log('==========================================');
    
    // Validate OpenAI connection on startup
    if (process.env.OPENAI_API_KEY) {
        console.log('✅ OpenAI API key found in environment variables');
    } else {
        console.log('❌ OpenAI API key not found - AI features will not work');
    }
});
