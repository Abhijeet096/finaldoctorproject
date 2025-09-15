// Merged script.js - Combined main video call functionality with AI chat integration
// Enhanced AI Health Mate Script with OpenAI Integration and Full WebRTC Implementation

// ------------------ Global Variables ------------------
let socket = null;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isCallActive = false;
let currentRoomId = null;
let currentUserId = null;
let currentUser = null;
let currentSection = 'home';
let isMuted = false;
let isCameraOff = false;

// NEW: AI Chat Variables
let currentChatSession = null;
let isAIChatActive = false;
let chatHistory = [];

// Navigation history for back button functionality
let navigationHistory = ['home'];

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

// Socket.IO Configuration
const SOCKET_CONFIG = {
    transports: ['websocket', 'polling'],
    upgrade: true,
    rememberUpgrade: true,
    timeout: 20000,
    forceNew: true
};

const API_BASE = "http://localhost:5000/api/auth";

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 AI Health Mate initialized');
    initializeApp();
});

function initializeApp() {
    // Set up event listeners
    setupEventListeners();
    
    // Initialize socket connection
    initializeSocket();
    
    // Check for saved user session
    checkUserSession();
    
    // Initialize dark mode
    initializeDarkMode();
    
    // Initialize notification system
    initializeNotifications();
    
    console.log('✅ Application initialized successfully');
}

function setupEventListeners() {
    // Contact form
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', handleContactForm);
    }

    // Login forms
    const patientLoginForm = document.getElementById('patientLoginForm');
    if (patientLoginForm) {
        patientLoginForm.addEventListener('submit', handlePatientLogin);
    }

    const doctorLoginForm = document.getElementById('doctorLoginForm');
    if (doctorLoginForm) {
        doctorLoginForm.addEventListener('submit', handleDoctorLogin);
    }

    // Signup forms
    const patientSignupForm = document.getElementById('patientSignupForm');
    if (patientSignupForm) {
        patientSignupForm.addEventListener('submit', handlePatientSignup);
    }

    const doctorSignupForm = document.getElementById('doctorSignupForm');
    if (doctorSignupForm) {
        doctorSignupForm.addEventListener('submit', handleDoctorSignup);
    }

    // Chat input
    const symptomInput = document.getElementById('symptomInput');
    if (symptomInput) {
        symptomInput.addEventListener('keypress', handleChatKeyPress);
        // Add click event listener to debug focus issues
        symptomInput.addEventListener('click', () => {
            console.log('symptomInput clicked, disabled:', symptomInput.disabled);
            if (!symptomInput.disabled) {
                symptomInput.focus();
            }
        });
    } else {
        console.warn('symptomInput element not found in DOM');
    }
}

function initializeSocket() {
    try {
        // Try to connect to local server first, then fallback to other addresses
        const possibleHosts = [
            window.location.origin,
            'http://localhost:5000',
            'http://127.0.0.1:5000'
        ];

        let hostIndex = 0;
        
        function tryConnection() {
            if (hostIndex >= possibleHosts.length) {
                console.error('❌ Could not connect to any server');
                showNotification('Unable to connect to server. Please check if the server is running.', 'error');
                return;
            }

            const currentHost = possibleHosts[hostIndex];
            console.log(`🔌 Attempting to connect to: ${currentHost}`);

            socket = io(currentHost, SOCKET_CONFIG);

            socket.on('connect', () => {
                console.log(`✅ Connected to server: ${currentHost}`);
                console.log(`📡 Socket ID: ${socket.id}`);
                setupSocketListeners();
                updateConnectionStatus('Connected');
                
                // Join as user if logged in
                if (currentUser) {
                    joinAsUser();
                }
            });

            socket.on('connect_error', (error) => {
                console.log(`❌ Connection failed to ${currentHost}:`, error.message);
                socket.disconnect();
                hostIndex++;
                setTimeout(tryConnection, 1000);
            });

            socket.on('disconnect', (reason) => {
                console.log('❌ Disconnected from server:', reason);
                updateConnectionStatus('Disconnected');
                
                if (reason === 'io server disconnect') {
                    // Server disconnected, try to reconnect
                    setTimeout(() => socket.connect(), 2000);
                }
            });
        }

        tryConnection();

    } catch (error) {
        console.error('Socket initialization error:', error);
        showNotification('Failed to initialize connection', 'error');
    }
}

function setupSocketListeners() {
    // User join confirmation
    socket.on('join-confirmed', (data) => {
        console.log('✅ Join confirmed:', data);
        updateOnlineCounters(data.onlineDoctors, data.onlinePatients);
    });

    // Online doctors list (for patients)
    socket.on('doctors-online', (doctors) => {
        console.log('👨‍⚕️ Online doctors updated:', doctors);
        updateOnlineDoctorsUI(doctors);
    });

    // Waiting patients (for doctors)
    socket.on('waiting-patients', (patients) => {
        console.log('⏳ Waiting patients updated:', patients);
        updateWaitingPatientsUI(patients);
    });

    // NEW: AI Chat Event Listeners
    socket.on('ai-chat-started', (data) => {
        console.log('🤖 AI Chat started:', data);
        currentChatSession = data.sessionId;
        isAIChatActive = true;
        
        // Add AI welcome message to chat
        addChatMessage('ai', data.message);
        showNotification('AI consultation started successfully', 'success');
        enableChatInput(); // Ensure input is enabled after chat starts
    });

    socket.on('ai-chat-response', (data) => {
        console.log('🤖 AI Response received:', data);
        addChatMessage('ai', data.message);
        enableChatInput();
    });

    socket.on('ai-chat-error', (data) => {
        console.error('❌ AI Chat error:', data);
        showNotification(data.message, 'error');
        enableChatInput();
    });

    // NEW: Prescription Event Listeners
    socket.on('prescription-generated', (data) => {
        console.log('📋 Prescription generated:', data);
        showNotification(data.message, 'success');
        addChatMessage('ai', data.message);
    });

    socket.on('prescription-approved', (data) => {
        console.log('✅ Prescription approved:', data);
        showNotification(data.message, 'success');
        
        // Show prescription in chat
        const prescriptionMessage = `
            <div class="prescription-approved">
                <h4>✅ Prescription Approved by ${data.doctorName}</h4>
                <div class="prescription-content">
                    ${data.content.replace(/\n/g, '<br>')}
                </div>
                <button onclick="downloadPrescription('${data.prescriptionId}')" class="btn btn-outline">
                    <i class="fas fa-download"></i> Download PDF
                </button>
            </div>
        `;
        addChatMessage('ai', prescriptionMessage);
    });

    socket.on('prescription-rejected', (data) => {
        console.log('❌ Prescription rejected:', data);
        showNotification(data.message, 'error');
        addChatMessage('ai', `Your consultation has been reviewed by ${data.doctorName}. ${data.reason ? `Reason: ${data.reason}` : ''} Please consider scheduling a video consultation for personalized care.`);
    });

    // NEW: Doctor prescription notifications
    socket.on('new-prescription-approval', (prescriptionData) => {
        console.log('📋 New prescription for approval:', prescriptionData);
        
        if (currentUser && currentUser.userType === 'doctor') {
            showNotification(`New prescription from AI consultation requires your approval`, 'info');
            addPrescriptionToApprovalList(prescriptionData);
        }
    });

    socket.on('pending-prescriptions-list', (prescriptions) => {
        console.log('📋 Pending prescriptions list:', prescriptions);
        
        if (currentUser && currentUser.userType === 'doctor') {
            displayPendingPrescriptions(prescriptions);
        }
    });

    // Video call event listeners
    socket.on('incoming-call-request', (data) => {
        console.log('📞 Incoming call request:', data);
        showIncomingCallDialogEnhanced(data.patientId, data.patientName, data.requestId);
    });

    socket.on('call-accepted', (data) => {
        console.log('Call accepted:', data);
        const { roomId, doctorName, doctorId } = data;
        currentRoomId = roomId;
        showNotification(`Dr. ${doctorName} accepted your call!`, 'success');
        updateVideoCallUI('call-accepted');
        startWebRTCCall(true); // Patient initiates the call
    });

    socket.on('call-rejected', (data) => {
        console.log('Call rejected:', data);
        const { doctorName, message } = data;
        showNotification(message || `Call rejected`, 'error');
        resetVideoCallUI();
    });

    socket.on('call-taken', (data) => {
        console.log('Call taken by another doctor:', data);
        const { patientId } = data;
        removeCallRequest(patientId);
    });

    socket.on('call-started', (data) => {
        const { roomId, patientId, patientName } = data;
        console.log('Call started:', data);
        currentRoomId = roomId;
        showNotification(`Call started with ${patientName}`, 'success');
        updateVideoCallUI('call-started');
        startWebRTCCall(false); // Doctor waits for offer
    });

    socket.on('call-ended', () => {
        console.log('Call ended by other party');
        endVideoCall();
        showNotification('Call ended', 'info');
    });

    // WebRTC signaling events
    socket.on('webrtc-offer', async (data) => {
        console.log('Received WebRTC offer:', data);
        const { offer, from } = data;
        await handleWebRTCOffer(offer);
    });

    socket.on('webrtc-answer', async (data) => {
        console.log('Received WebRTC answer:', data);
        const { answer, from } = data;
        await handleWebRTCAnswer(answer);
    });

    socket.on('webrtc-ice-candidate', async (data) => {
        const { candidate, from } = data;
        await handleICECandidate(candidate);
    });
}

// ------------------ Navigation ------------------
function showSection(sectionId) {
    console.log(`🔄 Navigating to section: ${sectionId}`);
    
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
        currentSection = sectionId;
        
        // Add to navigation history if not going back
        if (navigationHistory[navigationHistory.length - 1] !== sectionId) {
            navigationHistory.push(sectionId);
        }
        
        // Special handling for AI chat
        if (sectionId === 'ai-chat') {
            if (!isAIChatActive && currentUser) {
                setTimeout(() => {
                    startAIChat();
                }, 500);
            } else if (currentUser) {
                // Ensure input is enabled when navigating to ai-chat
                enableChatInput();
            }
        }
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function handleBackButton() {
    console.log('⬅️ Back button pressed');
    
    // Remove current section from history
    if (navigationHistory.length > 1) {
        navigationHistory.pop();
    }
    
    // Get previous section
    const previousSection = navigationHistory[navigationHistory.length - 1];
    
    // Navigate based on current user state
    let targetSection = previousSection;
    
    if (currentSection === 'ai-chat' || currentSection === 'video-call') {
        if (currentUser) {
            targetSection = currentUser.userType === 'patient' ? 'patient-dashboard' : 'doctor-dashboard';
        } else {
            targetSection = 'home';
        }
    }
    
    console.log(`🎯 Navigating back to: ${targetSection}`);
    showSection(targetSection);
}

// ------------------ Notifications ------------------
function showNotification(message, type = "success") {
    const note = document.createElement("div");
    note.className = `notification ${type}`;
    note.innerText = message;
    document.body.appendChild(note);

    setTimeout(() => note.classList.add("show"), 50);
    setTimeout(() => {
        note.classList.remove("show");
        setTimeout(() => note.remove(), 300);
    }, 3000);
}

// ------------------ Authentication ------------------

let userSession = {
    token: null,
    user: null,
    userType: null
};

// ---------- Patient Login ----------
async function handlePatientLogin(event) {
    event.preventDefault();

    const email = document.getElementById("patientEmail").value;
    const password = document.getElementById("patientPassword").value;

    if (!email || !password) {
        showNotification("Please fill in all fields", "error");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/patient/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        let data;
        try {
            data = await res.json();
        } catch {
            throw new Error("Server did not return JSON: " + await res.text());
        }

        if (!res.ok) throw new Error(data.message || "Login failed");

        userSession.token = data.token;
        userSession.user = data.user;
        userSession.userType = "patient";
        currentUserId = data.user._id;
        currentUser = { ...data.user, userType: 'patient' };

        showNotification(`Welcome ${data.user.name}`, "success");
        
        const patientNameEl = document.getElementById("patientName");
        if (patientNameEl) {
            patientNameEl.textContent = data.user.name;
        }
        
        // Ensure socket is initialized
        if (!socket) {
            console.log('Socket not initialized, calling initializeSocket...');
            initializeSocket();
        }

        // Join as user
        if (socket && socket.connected) {
            joinAsUser();
        } else {
            console.log('Socket not connected, waiting for connection...');
            if (socket) {
                socket.on('connect', () => {
                    console.log('Socket connected, joining as user...');
                    joinAsUser();
                });
            }
            // Add a timeout to handle connection failure
            setTimeout(() => {
                if (socket && !socket.connected) {
                    showNotification("Failed to connect to server. Real-time features may be unavailable.", "warning");
                    // Proceed to dashboard even if socket is not connected
                    showSection('patient-dashboard');
                }
            }, 5000); // Wait 5 seconds for connection
        }
        
        // Save session
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        // Show dashboard immediately
        showSection('patient-dashboard');
    } catch (err) {
        console.error("Login error:", err);
        showNotification(err.message || "Something went wrong. Please try again!", "error");
    }
}

// ------------------ Patient Signup ------------------
async function handlePatientSignup(event) {
    event.preventDefault();

    const payload = {
        name: document.getElementById("signupName").value,
        email: document.getElementById("signupEmail").value,
        phone: document.getElementById("signupPhone").value,
        age: document.getElementById("signupAge").value,
        password: document.getElementById("signupPassword").value
    };

    if (!payload.name || !payload.email || !payload.phone || !payload.age || !payload.password) {
        showNotification("Please fill in all fields", "error");
        return;
    }
                            
    try {
        const res = await fetch(`${API_BASE}/patient/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        let data;
        try {
            data = await res.json();
        } catch (jsonErr) {
            const text = await res.text();
            throw new Error("Server did not return JSON. Response: " + text);
        }

        if (!res.ok) throw new Error(data.message || "Signup failed");

        showNotification("Patient account created! Please log in.", "success");
        showSection("patient-login");

    } catch (err) {
        console.error("Signup error:", err);
        showNotification(err.message, "error");
    }
}

// ---------- Doctor Login ----------
async function handleDoctorLogin(event) {
    event.preventDefault();

    const email = document.getElementById("doctorEmail").value;
    const password = document.getElementById("doctorPassword").value;

    if (!email || !password) {
        showNotification("Please fill in all fields", "error");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/doctor/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        let data;
        try {
            data = await res.json();
        } catch {
            throw new Error("Server did not return JSON: " + await res.text());
        }

        if (!res.ok) throw new Error(data.message || "Login failed");

        userSession.token = data.token;
        userSession.user = data.user;
        userSession.userType = "doctor";
        currentUserId = data.user._id;
        currentUser = { ...data.user, userType: 'doctor' };

        showNotification(`Welcome Dr. ${data.user.name}`, "success");
        
        const doctorNameEl = document.getElementById("doctorName");
        if (doctorNameEl) {
            doctorNameEl.textContent = `Dr. ${data.user.name}`;
        }
        
        // Ensure socket is initialized
        if (!socket) {
            console.log('Socket not initialized, calling initializeSocket...');
            initializeSocket();
        }

        // Join as user
        if (socket && socket.connected) {
            joinAsUser();
        } else {
            console.log('Socket not connected, waiting for connection...');
            if (socket) {
                socket.on('connect', () => {
                    console.log('Socket connected, joining as user...');
                    joinAsUser();
                });
            }
            // Add a timeout to handle connection failure
            setTimeout(() => {
                if (socket && !socket.connected) {
                    showNotification("Failed to connect to server. Real-time features may be unavailable.", "warning");
                    // Proceed to dashboard even if socket is not connected
                    showSection('doctor-dashboard');
                }
            }, 5000); // Wait 5 seconds for connection
        }
        
        // Save session
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        // Show dashboard immediately
        showSection('doctor-dashboard');
    } catch (err) {
        console.error("Login error:", err);
        showNotification(err.message || "Something went wrong. Please try again!", "error");
    }
}

// ---------- Doctor Signup ----------
async function handleDoctorSignup(event) {
    event.preventDefault();

    const payload = {
        name: document.getElementById("doctorSignupName").value,
        email: document.getElementById("doctorSignupEmail").value,
        license: document.getElementById("doctorSignupLicense").value,
        specialty: document.getElementById("doctorSignupSpecialty").value,
        password: document.getElementById("doctorSignupPassword").value
    };

    if (!payload.name || !payload.email || !payload.license || !payload.specialty || !payload.password) {
        showNotification("Please fill in all fields", "error");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/doctor/signup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        let data;
        try {
            data = await res.json();
        } catch (jsonErr) {
            const text = await res.text();
            throw new Error("Server did not return JSON. Response: " + text);
        }

        if (!res.ok) throw new Error(data.message || "Signup failed");

        showNotification("Doctor account created! Please log in.", "success");
        showSection("doctor-login");

    } catch (err) {
        console.error("Signup error:", err);
        showNotification(err.message, "error");
    }
}

// ---------- Logout ----------
function logout() {
    console.log('👋 User logging out');
    
    if (socket) {
        socket.disconnect();
    }
    
    if (isCallActive) {
        endVideoCall();
    }
    
    // Clear user data
    currentUser = null;
    currentChatSession = null;
    isAIChatActive = false;
    chatHistory = [];
    
    userSession = {
        token: null,
        user: null,
        userType: null
    };
    currentUserId = null;
    
    // Clear storage
    localStorage.removeItem('currentUser');
    
    // Reset UI
    clearChatMessages();
    
    showNotification("Logged out successfully");
    showSection("home");
    
    // Reinitialize socket
    setTimeout(initializeSocket, 1000);
}

// ------------------ Real-time Video Call Functions ------------------

// Patient requests video call
async function startVideoCall() {
    console.log('Starting video call...');
    
    if (!socket || !currentUser) {
        showNotification("Please login first", "error");
        return;
    }

    if (!socket.connected) {
        showNotification("Connection lost. Please refresh and try again.", "error");
        return;
    }

    try {
        // Get user media with better constraints
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }, 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        console.log('Got local stream');
        
        // Show local video
        displayLocalVideo();
        
        // Only patients should request calls to doctors
        if (currentUser.userType === 'patient') {
            console.log('Sending video call request...');
            socket.emit('request-video-call', {
                patientId: currentUser._id,
                patientName: currentUser.name
            });
            
            showNotification("Requesting video call with available doctors...", "info");
            updateVideoCallUI('requesting');
        } else if (currentUser.userType === 'doctor') {
            showNotification("Video call started. Waiting for patient...", "info");
            updateVideoCallUI('call-started');
        }
        
    } catch (err) {
        console.error("Video call error:", err);
        let errorMessage = "Could not access camera/microphone";
        
        if (err.name === 'NotAllowedError') {
            errorMessage = "Camera/microphone access denied. Please allow permissions and try again.";
        } else if (err.name === 'NotFoundError') {
            errorMessage = "No camera or microphone found. Please check your devices.";
        } else if (err.name === 'NotReadableError') {
            errorMessage = "Camera or microphone is already in use by another application.";
        }
        
        showNotification(errorMessage, "error");
        resetVideoCallUI();
    }
}

// Display local video stream
function displayLocalVideo() {
    const localVideo = document.getElementById("localVideo");
    const placeholder = document.getElementById("localVideoPlaceholder");
    
    if (localVideo && localStream) {
        localVideo.srcObject = localStream;
        localVideo.style.display = "block";
        if (placeholder) placeholder.style.display = "none";
        
        console.log('Local video displayed');
        updateConnectionStatus("Connected");
    }
}

// Display remote video stream
function displayRemoteVideo() {
    const localVideo = document.getElementById("remoteVideo");
    const placeholder = document.getElementById("remoteVideoPlaceholder");
    
    if (localVideo && remoteStream) {
        localVideo.srcObject = remoteStream;
        localVideo.style.display = "block";
        if (placeholder) placeholder.style.display = "none";
        
        console.log('Remote video displayed');
        updateConnectionStatus("Call Active");
    }
}

// Update connection status
function updateConnectionStatus(status) {
    const statusEl = document.getElementById("connectionStatus");
    if (statusEl) {
        statusEl.innerHTML = `<i class="fas fa-wifi"></i> ${status}`;
    }
}

// Start WebRTC connection
async function startWebRTCCall(isInitiator) {
    console.log('Starting WebRTC call, initiator:', isInitiator);
    
    try {
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        // Add local stream to peer connection
        if (localStream) {
            localStream.getTracks().forEach(track => {
                console.log('Adding track to peer connection');
                peerConnection.addTrack(track, localStream);
            });
        }
        
        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log("Received remote stream");
            remoteStream = event.streams[0];
            displayRemoteVideo();
        };
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket && currentRoomId) {
                console.log("Sending ICE candidate");
                socket.emit('webrtc-ice-candidate', {
                    roomId: currentRoomId,
                    candidate: event.candidate
                });
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            console.log("Connection state:", peerConnection.connectionState);
            updateConnectionStatus(peerConnection.connectionState);
        };
        
        if (isInitiator) {
            // Create offer
            console.log('Creating offer...');
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await peerConnection.setLocalDescription(offer);
            
            console.log("Sending offer");
            socket.emit('webrtc-offer', {
                roomId: currentRoomId,
                offer: offer
            });
        }
        
        isCallActive = true;
        
    } catch (error) {
        console.error("Error starting WebRTC call:", error);
        showNotification("Failed to start video call", "error");
        resetVideoCallUI();
    }
}

// Handle WebRTC offer
async function handleWebRTCOffer(offer) {
    try {
        if (!peerConnection) {
            await startWebRTCCall(false);
        }
        
        console.log("Received offer, setting remote description");
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        console.log("Sending answer");
        socket.emit('webrtc-answer', {
            roomId: currentRoomId,
            answer: answer
        });
        
    } catch (error) {
        console.error("Error handling WebRTC offer:", error);
        showNotification("Failed to handle call offer", "error");
    }
}

// Handle WebRTC answer
async function handleWebRTCAnswer(answer) {
    try {
        if (peerConnection) {
            console.log("Received answer, setting remote description");
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
    } catch (error) {
        console.error("Error handling WebRTC answer:", error);
        showNotification("Failed to handle call answer", "error");
    }
}

// Handle ICE candidate
async function handleICECandidate(candidate) {
    try {
        if (peerConnection && peerConnection.remoteDescription) {
            console.log("Adding ICE candidate");
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (error) {
        console.error("Error handling ICE candidate:", error);
    }
}

// End video call
function endVideoCall() {
    console.log('Ending video call...');
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }
    
    // Close peer connection
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    // Reset remote stream
    remoteStream = null;
    
    // Notify server if call is active
    if (isCallActive && socket && currentRoomId) {
        socket.emit('end-call', { roomId: currentRoomId });
    }
    
    isCallActive = false;
    currentRoomId = null;
    
    resetVideoCallUI();
    updateConnectionStatus("Disconnected");
}

// Update video call UI based on state
function updateVideoCallUI(state) {
    const startBtn = document.getElementById("startCallBtn");
    const endBtn = document.getElementById("endCallBtn");
    const muteBtn = document.getElementById("muteBtn");
    const cameraBtn = document.getElementById("cameraBtn");
    
    console.log('Updating UI state:', state);
    
    switch(state) {
        case 'requesting':
            if (startBtn) startBtn.style.display = "none";
            if (endBtn) {
                endBtn.style.display = "inline-block";
                endBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Request';
            }
            if (muteBtn) muteBtn.style.display = "inline-block";
            if (cameraBtn) cameraBtn.style.display = "inline-block";
            break;
            
        case 'call-accepted':
        case 'call-started':
            if (startBtn) startBtn.style.display = "none";
            if (endBtn) {
                endBtn.style.display = "inline-block";
                endBtn.innerHTML = '<i class="fas fa-phone-slash"></i> End Call';
            }
            if (muteBtn) muteBtn.style.display = "inline-block";
            if (cameraBtn) cameraBtn.style.display = "inline-block";
            break;
    }
}

// Reset video call UI
function resetVideoCallUI() {
    const startBtn = document.getElementById("startCallBtn");
    const endBtn = document.getElementById("endCallBtn");
    const muteBtn = document.getElementById("muteBtn");
    const cameraBtn = document.getElementById("cameraBtn");
    const localVideo = document.getElementById("localVideo");
    const remoteVideo = document.getElementById("remoteVideo");
    const localPlaceholder = document.getElementById("localVideoPlaceholder");
    const remotePlaceholder = document.getElementById("remoteVideoPlaceholder");
    
    if (startBtn) startBtn.style.display = "inline-block";
    if (endBtn) endBtn.style.display = "none";
    if (muteBtn) muteBtn.style.display = "none";
    if (cameraBtn) cameraBtn.style.display = "none";
    
    if (localVideo) {
        localVideo.style.display = "none";
        localVideo.srcObject = null;
    }
    if (remoteVideo) {
        remoteVideo.style.display = "none";
        remoteVideo.srcObject = null;
    }
    if (localPlaceholder) localPlaceholder.style.display = "block";
    if (remotePlaceholder) remotePlaceholder.style.display = "block";
}

// Toggle mute/unmute
function toggleMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const muteBtn = document.getElementById("muteBtn");
            if (muteBtn) {
                muteBtn.innerHTML = audioTrack.enabled ? 
                    '<i class="fas fa-microphone"></i> Mute' : 
                    '<i class="fas fa-microphone-slash"></i> Unmute';
            }
            showNotification(audioTrack.enabled ? "Microphone unmuted" : "Microphone muted", "info");
        }
    }
}

// Toggle camera on/off
function toggleCamera() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const cameraBtn = document.getElementById("cameraBtn");
            if (cameraBtn) {
                cameraBtn.innerHTML = videoTrack.enabled ? 
                    '<i class="fas fa-video"></i> Camera' : 
                    '<i class="fas fa-video-slash"></i> Camera';
            }
            showNotification(videoTrack.enabled ? "Camera turned on" : "Camera turned off", "info");
        }
    }
}

// Show incoming call dialog for doctors
function showIncomingCallDialog(patientId, patientName, requestId) {
    console.log('Showing incoming call dialog:', { patientId, patientName, requestId });
    
    // Remove existing dialog if any
    const existingDialog = document.getElementById('incomingCallDialog');
    if (existingDialog) {
        existingDialog.remove();
    }
    
    const dialog = document.createElement('div');
    dialog.id = 'incomingCallDialog';
    dialog.className = 'incoming-call-dialog';
    dialog.innerHTML = `
        <div class="call-dialog-content">
            <div class="call-dialog-header">
                <i class="fas fa-video pulse"></i>
                <h3>Incoming Video Call</h3>
            </div>
            <div class="call-dialog-body">
                <p><strong>${patientName}</strong> is requesting a video consultation</p>
                <div class="call-dialog-actions">
                    <button onclick="acceptCall('${patientId}', '${patientName}')" class="btn btn-secondary">
                        <i class="fas fa-video"></i> Accept
                    </button>
                    <button onclick="rejectCall('${patientId}')" class="btn btn-danger">
                        <i class="fas fa-phone-slash"></i> Reject
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Auto-reject after 30 seconds
    setTimeout(() => {
        const stillExists = document.getElementById('incomingCallDialog');
        if (stillExists) {
            console.log('Auto-rejecting call after timeout');
            rejectCall(patientId);
        }
    }, 30000);
}

// Remove call request dialog
function removeCallRequest(patientId) {
    const dialog = document.getElementById('incomingCallDialog');
    if (dialog) {
        dialog.remove();
        console.log('Call request dialog removed');
    }
}

// Doctor accepts call
async function acceptCall(patientId, patientName) {
    console.log('Doctor accepting call from:', patientName);
    
    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }, 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        displayLocalVideo();
        
        console.log('Emitting accept-call...');
        socket.emit('accept-call', {
            patientId: patientId,
            doctorId: currentUser._id,
            doctorName: currentUser.name
        });
        
        // Remove dialog
        removeCallRequest(patientId);
        
        showNotification(`Accepted call from ${patientName}`, 'success');
        updateVideoCallUI('call-started');
        
    } catch (err) {
        console.error("Error accepting call:", err);
        let errorMessage = "Could not access camera/microphone";
        
        if (err.name === 'NotAllowedError') {
            errorMessage = "Camera/microphone access denied. Please allow permissions and try again.";
        }
        
        showNotification(errorMessage, "error");
        removeCallRequest(patientId);
    }
}

// Doctor rejects call
function rejectCall(patientId) {
    console.log('Doctor rejecting call from patient:', patientId);
    
    if (socket) {
        socket.emit('reject-call', {
            patientId: patientId,
            doctorId: currentUser._id
        });
    }
    
    removeCallRequest(patientId);
    showNotification("Call request rejected", "info");
}

// Update online doctors UI for patients
function updateOnlineDoctorsUI(doctors) {
    const container = document.getElementById('onlineDoctorsContainer');
    if (!container) return;
    
    console.log('Updating online doctors UI:', doctors);
    
    container.innerHTML = `
        <h4><i class="fas fa-user-md"></i> Available Doctors (${doctors.length})</h4>
        ${doctors.length === 0 ? 
            '<p style="color: var(--text-light); margin: 1rem 0;">No doctors currently online.</p>' :
            doctors.map(doctor => `
                <div class="doctor-item">
                    <div class="doctor-info">
                        <i class="fas fa-circle ${doctor.status === 'online' ? 'online' : 'busy'}"></i>
                        Dr. ${doctor.name} (${doctor.specialty || 'General'})
                    </div>
                    <span class="doctor-status">${doctor.status}</span>
                </div>
            `).join('')
        }
    `;
}

// Update waiting patients UI for doctors
function updateWaitingPatientsUI(patients) {
    const container = document.getElementById('waitingPatientsContainer');
    if (!container) return;
    
    console.log('Updating waiting patients UI:', patients);
    
    container.innerHTML = `
        <h4><i class="fas fa-clock"></i> Waiting Patients (${patients.length})</h4>
        ${patients.length === 0 ? 
            '<p style="color: var(--text-light); margin: 1rem 0;">No patients currently waiting for consultation.</p>' :
            patients.map(patient => `
                <div class="patient-item">
                    <div class="patient-info">
                        <i class="fas fa-user"></i>
                        ${patient.name}
                    </div>
                    <button onclick="acceptCall('${patient.id}', '${patient.name}')" class="btn btn-sm btn-primary">
                        Accept Call
                    </button>
                </div>
            `).join('')
        }
    `;
}

// ------------------ AI Chat Functions ------------------
function startAIChat() {
    if (!socket || !socket.connected) {
        showNotification('Please wait for connection to establish', 'error');
        enableChatInput(); // Enable input as fallback
        return;
    }

    if (!currentUser) {
        showNotification('Please log in to start AI consultation', 'error');
        enableChatInput(); // Enable input as fallback
        return;
    }

    console.log('🤖 Starting AI chat session...');
    
    // Clear previous chat
    clearChatMessages();
    chatHistory = [];
    
    // Send start chat request
    socket.emit('start-ai-chat', {
        patientId: currentUser._id,
        patientName: currentUser.name
    });
    
    showNotification('Initializing AI consultation...', 'info');
    disableChatInput();
    
    // Fallback: Enable input if chat doesn't start within 5 seconds
    setTimeout(() => {
        if (!isAIChatActive) {
            console.warn('AI chat session failed to start, enabling input');
            showNotification('Failed to start AI chat. You can still type symptoms.', 'warning');
            enableChatInput();
        }
    }, 5000);
}

function sendSymptomMessage() {
    const input = document.getElementById("symptomInput");
    if (!input) {
        console.warn('symptomInput element not found');
        return;
    }
    
    const message = input.value.trim();
    if (!message) return;

    if (!currentChatSession && !isAIChatActive) {
        // Start AI chat session first
        startAIChat();
        
        // Wait a moment for session to initialize, then send message
        setTimeout(() => {
            if (currentChatSession) {
                sendAIMessage(message);
                input.value = '';
            }
        }, 1000);
        return;
    }
    
    sendAIMessage(message);
    input.value = '';
}

function sendAIMessage(message) {
    if (!socket || !socket.connected) {
        showNotification('Connection lost. Please refresh the page.', 'error');
        enableChatInput(); // Enable input as fallback
        return;
    }

    if (!currentChatSession) {
        showNotification('No active chat session. Please start a new consultation.', 'error');
        enableChatInput(); // Enable input as fallback
        return;
    }

    console.log(`💬 Sending AI message: ${message}`);
    
    // Add user message to chat immediately
    addChatMessage('user', message);
    
    // Add to history
    chatHistory.push({ sender: 'user', content: message, timestamp: Date.now() });
    
    // Disable input while processing
    disableChatInput();
    
    // Show typing indicator
    showTypingIndicator();
    
    // Send to server
    socket.emit('ai-chat-message', {
        sessionId: currentChatSession,
        message: message,
        patientId: currentUser._id
    });
}

function handleChatKeyPress(event) {
    console.log('Key pressed on symptomInput:', event.key);
    if (event.key === 'Enter') {
        sendSymptomMessage();
    }
}

function addChatMessage(sender, content, timestamp = null) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}`;
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    
    // Handle HTML content for prescriptions
    if (content.includes('<div class="prescription-approved">')) {
        messageContent.innerHTML = content;
    } else {
        messageContent.innerHTML = `<p>${content}</p>`;
    }
    
    if (timestamp) {
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date(timestamp).toLocaleTimeString();
        messageContent.appendChild(timeDiv);
    }
    
    messageDiv.appendChild(messageContent);
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Remove typing indicator if exists
    hideTypingIndicator();
}

function clearChatMessages() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    
    // Keep the initial AI greeting
    chatMessages.innerHTML = `
        <div class="message ai">
            <div class="message-content">
                <p>Hello! I'm your AI Health Assistant. Please describe your symptoms, and I'll provide a preliminary analysis. Remember, this is not a substitute for professional medical advice.</p>
            </div>
        </div>
    `;
}

function showTypingIndicator() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    // Remove existing typing indicator
    hideTypingIndicator();
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message ai typing-indicator';
    typingDiv.innerHTML = `
        <div class="message-content">
            <p>AI Assistant is typing<span class="typing-dots">...</span></p>
        </div>
    `;
    
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTypingIndicator() {
    const typingIndicator = document.querySelector('.typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

function disableChatInput() {
    const input = document.getElementById('symptomInput');
    const button = input?.nextElementSibling;
    
    if (input) {
        input.disabled = true;
        input.placeholder = 'AI is processing your message...';
        console.log('Chat input disabled');
    }
    
    if (button) {
        button.disabled = true;
    }
}

function enableChatInput() {
    const input = document.getElementById('symptomInput');
    const button = input?.nextElementSibling;
    
    if (input) {
        input.disabled = false;
        input.placeholder = 'Describe your symptoms...';
        input.focus();
        console.log('Chat input enabled');
    }
    
    if (button) {
        button.disabled = false;
    }
}

// ------------------ Prescription Management Functions ------------------
function addPrescriptionToApprovalList(prescriptionData) {
    // This function adds prescription to doctor's approval list
    // Implementation depends on your UI structure
    console.log('Adding prescription to approval list:', prescriptionData);
    
    // You can implement UI update here
    const prescriptionsContainer = document.getElementById('pendingPrescriptionsContainer');
    if (prescriptionsContainer) {
        // Add prescription card to the container
        const prescriptionCard = createPrescriptionCard(prescriptionData);
        prescriptionsContainer.appendChild(prescriptionCard);
    }
}

function createPrescriptionCard(prescriptionData) {
    const card = document.createElement('div');
    card.className = 'prescription-card';
    card.setAttribute('data-prescription-id', prescriptionData.id);
    
    card.innerHTML = `
        <div class="prescription-header">
            <h4>Patient: ${prescriptionData.patientName}</h4>
            <small>AI Generated Prescription | ${new Date(prescriptionData.createdAt).toLocaleString()}</small>
        </div>
        <div class="prescription-content">
            <h5>AI Consultation Summary:</h5>
            <div class="consultation-summary">
                ${prescriptionData.conversationSummary?.replace(/\n/g, '<br>') || 'No summary available'}
            </div>
            <h5>Suggested Treatment:</h5>
            <div class="treatment-content">
                ${prescriptionData.content.replace(/\n/g, '<br>')}
            </div>
            <div class="prescription-actions">
                <button onclick="approvePrescription('${prescriptionData.id}')" class="btn btn-secondary">
                    <i class="fas fa-check"></i> Approve
                </button>
                <button onclick="rejectPrescription('${prescriptionData.id}')" class="btn btn-danger">
                    <i class="fas fa-times"></i> Reject
                </button>
                <button onclick="modifyPrescription('${prescriptionData.id}')" class="btn btn-outline">
                    <i class="fas fa-edit"></i> Modify
                </button>
            </div>
        </div>
    `;
    
    return card;
}

function displayPendingPrescriptions(prescriptions) {
    console.log('Displaying pending prescriptions:', prescriptions);
    
    // Update the pending prescriptions section in doctor dashboard
    const container = document.querySelector('#doctor-dashboard .prescription-card');
    if (container && prescriptions.length > 0) {
        // Clear existing static prescriptions and add real ones
        const parentContainer = container.parentElement;
        parentContainer.innerHTML = '<h3><i class="fas fa-clipboard-check"></i> Pending Prescription Approvals</h3>';
        
        prescriptions.forEach(prescription => {
            const card = createPrescriptionCard(prescription);
            parentContainer.appendChild(card);
        });
    }
}

function approvePrescription(id) {
    showNotification(`Prescription ${id} approved`, "success");
}

function rejectPrescription(id) {
    showNotification(`Prescription ${id} rejected`, "error");
}

function modifyPrescription(id) {
    showNotification(`Editing prescription ${id}`, "info");
}

function downloadPrescription(id) {
    showNotification(`Prescription ${id} downloaded`, "success");
}

// ------------------ Dashboard Functions ------------------
function viewPrescriptions() {
    const prescriptionsView = document.getElementById("prescriptionsView");
    if (prescriptionsView) {
        prescriptionsView.style.display = prescriptionsView.style.display === "none" ? "block" : "none";
    }
    showNotification("Prescriptions loaded", "success");
}

function toggleDoctorStatus() {
    showNotification("Status updated", "success");
}

// ------------------ Helper functions ------------------
function showPatientSignup() {
    showSection("patient-signup");
}

function showDoctorSignup() {
    showSection("doctor-signup");
}

// ------------------ Dark Mode ------------------
function toggleDarkMode() {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    const darkModeBtn = document.getElementById("darkModeBtn");
    if (darkModeBtn) {
        darkModeBtn.innerHTML = isDark ? 
            '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    }
}

// ------------------ Additional Utility Functions ------------------

// Check if user is logged in
function isLoggedIn() {
    return userSession.user !== null && userSession.token !== null;
}

// Get current user info
function getCurrentUser() {
    return userSession.user;
}

// Check connection status
function checkConnectionStatus() {
    if (!socket) {
        return 'disconnected';
    }
    return socket.connected ? 'connected' : 'disconnected';
}

// Reconnect socket if disconnected
function reconnectSocket() {
    if (socket && !socket.connected && isLoggedIn()) {
        console.log('Attempting to reconnect...');
        socket.connect();
    }
}

// Handle page refresh - maintain session if possible
window.addEventListener('beforeunload', function(e) {
    if (isCallActive) {
        e.preventDefault();
        e.returnValue = 'You are currently in a video call. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// Handle page visibility change - pause/resume video when tab is hidden/shown
document.addEventListener('visibilitychange', function() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            if (document.hidden) {
                console.log('Page hidden, pausing video');
            } else {
                console.log('Page visible, resuming video');
            }
        }
    }
});

// Network connection monitoring
window.addEventListener('online', function() {
    console.log('Network connection restored');
    showNotification('Connection restored', 'success');
    reconnectSocket();
});

window.addEventListener('offline', function() {
    console.log('Network connection lost');
    showNotification('Connection lost. Please check your internet.', 'error');
});

// Error handler for unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    // Don't show notification for every unhandled rejection to avoid spam
    // showNotification('An unexpected error occurred', 'error');
});

// Global error handler
window.addEventListener('error', function(event) {
    console.error('Global error:', event.error);
    // Log error but don't show notification unless it's critical
});

// Cleanup function when page unloads
window.addEventListener('unload', function() {
    if (socket) {
        socket.disconnect();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
        peerConnection.close();
    }
});

// Initialize notification system
function initializeNotifications() {
    // Request notification permission for browser notifications
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// Show browser notification for incoming calls (when tab is not active)
function showBrowserNotification(title, body, onclick) {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        const notification = new Notification(title, {
            body: body,
            icon: '/favicon.ico', // Add your app icon
            badge: '/favicon.ico',
            tag: 'video-call',
            requireInteraction: true
        });
        
        notification.onclick = function() {
            window.focus();
            if (onclick) onclick();
            notification.close();
        };
        
        // Auto close after 10 seconds
        setTimeout(() => notification.close(), 10000);
    }
}

// Enhanced incoming call dialog with sound notification
function showIncomingCallDialogEnhanced(patientId, patientName, requestId) {
    console.log('Showing enhanced incoming call dialog:', { patientId, patientName, requestId });
    
    // Play notification sound if available
    try {
        // Create audio element for call notification sound
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmkaATiF0fPQgjIGIXPI8dyJOQgSUM/t559NEAxJsuPxtmMcBBmDwO3MeSUFJHfH8N2QQAoUYrTp66hVFAwZfeDx');
        audio.play().catch(e => console.log('Could not play notification sound'));
    } catch (e) {
        console.log('Audio notification not supported');
    }
    
    // Show browser notification if tab is not active
    showBrowserNotification(
        'Incoming Video Call',
        `${patientName} is requesting a video consultation`,
        () => {
            // Focus on the call dialog when notification is clicked
            const dialog = document.getElementById('incomingCallDialog');
            if (dialog) {
                dialog.scrollIntoView({ behavior: 'smooth' });
            }
        }
    );
    
    // Show the regular dialog
    showIncomingCallDialog(patientId, patientName, requestId);
}

// Session management
function checkUserSession() {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            userSession.user = currentUser;
            userSession.userType = currentUser.userType;
            console.log('💾 Restored user session:', currentUser.name);
            
            if (currentUser.userType === 'patient') {
                document.getElementById('patientName').textContent = currentUser.name;
                showSection('patient-dashboard');
            } else if (currentUser.userType === 'doctor') {
                document.getElementById('doctorName').textContent = currentUser.name;
                showSection('doctor-dashboard');
            }
            
            // Join socket when connected
            if (socket && socket.connected) {
                joinAsUser();
            }
            
        } catch (error) {
            console.error('Error restoring session:', error);
            localStorage.removeItem('currentUser');
        }
    }
}

function joinAsUser() {
    if (!socket || !currentUser) return;
    
    const userData = {
        userId: currentUser._id,
        userType: currentUser.userType,
        userName: currentUser.name
    };
    
    console.log('👤 Joining as user:', userData);
    socket.emit('join-as-user', userData);
}

// Export functions for global access if needed
window.showSection = showSection;
window.showPatientSignup = showPatientSignup;
window.showDoctorSignup = showDoctorSignup;
window.logout = logout;
window.startVideoCall = startVideoCall;
window.endVideoCall = endVideoCall;
window.toggleMute = toggleMute;
window.toggleCamera = toggleCamera;
window.toggleDarkMode = toggleDarkMode;
window.viewPrescriptions = viewPrescriptions;
window.downloadPrescription = downloadPrescription;
window.approvePrescription = approvePrescription;
window.rejectPrescription = rejectPrescription;
window.modifyPrescription = modifyPrescription;
window.toggleDoctorStatus = toggleDoctorStatus;
window.sendSymptomMessage = sendSymptomMessage;
window.handleChatKeyPress = handleChatKeyPress;
window.acceptCall = acceptCall;
window.rejectCall = rejectCall;

console.log('🎉 Merged AI Health Mate script loaded with OpenAI integration and full video call support');







