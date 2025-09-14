// script.js

// ------------------ Global Variables ------------------
let socket;
let localStream;
let remoteStream;
let peerConnection;
let isCallActive = false;
let currentRoomId = null;
let currentUserId = null;
let connectionRetryCount = 0;
const maxRetryAttempts = 3;

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// ------------------ Navigation ------------------
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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

// ------------------ Server Configuration ------------------
// REPLACE THIS URL WITH YOUR RENDER DEPLOYMENT URL AFTER DEPLOYMENT
const SERVER_BASE = 'https://your-app-name.onrender.com'; // 👈 UPDATE THIS WITH YOUR ACTUAL RENDER URL

// Get API base URL
function getApiBaseUrl() {
    return `${SERVER_BASE}/api/auth`;
}

// ------------------ Socket.IO Initialization ------------------
function initializeSocket() {
    console.log('Initializing socket connection...');
    console.log('Connecting to server:', SERVER_BASE);
    
    socket = io(SERVER_BASE, {
        transports: ['websocket', 'polling'], // Allow both transport methods
        timeout: 10000,
        forceNew: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
    });
    
    socket.on('connect', () => {
        console.log('Connected to server:', socket.id);
        connectionRetryCount = 0;
        showNotification('Connected to server', 'success');
        
        // Join as user immediately after connection
        if (userSession.user && userSession.userType) {
            console.log('Rejoining as user after reconnection...');
            joinAsUser();
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        showNotification('Connection lost. Attempting to reconnect...', 'error');
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        connectionRetryCount++;
        
        if (connectionRetryCount <= maxRetryAttempts) {
            showNotification(`Connection failed. Retrying... (${connectionRetryCount}/${maxRetryAttempts})`, 'error');
        } else {
            showNotification('Failed to connect. Please check your internet connection and refresh the page.', 'error');
        }
    });

    socket.on('reconnect', (attemptNumber) => {
        console.log('Reconnected after', attemptNumber, 'attempts');
        showNotification('Reconnected successfully!', 'success');
        
        // Rejoin as user after reconnection
        if (userSession.user && userSession.userType) {
            joinAsUser();
        }
    });

    // Join confirmation
    socket.on('join-confirmed', (data) => {
        console.log('Join confirmed:', data);
        currentUserId = data.userId;
    });

    // Patient receives call acceptance
    socket.on('call-accepted', (data) => {
        const { roomId, doctorName, doctorId } = data;
        console.log('Call accepted:', data);
        currentRoomId = roomId;
        showNotification(`Dr. ${doctorName} accepted your call!`, 'success');
        updateVideoCallUI('call-accepted');
        startWebRTCCall(true); // Patient initiates the call
    });

    // Doctor receives call start notification
    socket.on('call-started', (data) => {
        const { roomId, patientId, patientName } = data;
        console.log('Call started:', data);
        currentRoomId = roomId;
        showNotification(`Call started with ${patientName}`, 'success');
        updateVideoCallUI('call-started');
        startWebRTCCall(false); // Doctor waits for offer
    });

    // Call rejected
    socket.on('call-rejected', (data) => {
        const { doctorName, message } = data;
        console.log('Call rejected:', data);
        showNotification(message || 'Call rejected', 'error');
        resetVideoCallUI();
    });

    // Call failed
    socket.on('call-failed', (data) => {
        console.log('Call failed:', data);
        showNotification(data.message || 'Call failed', 'error');
        resetVideoCallUI();
    });

    // Incoming call request (for doctors)
    socket.on('incoming-call-request', (data) => {
        console.log('Incoming call request received:', data);
        const { patientId, patientName, requestId } = data;
        showIncomingCallDialog(patientId, patientName, requestId);
    });

    // Call was taken by another doctor
    socket.on('call-taken', (data) => {
        console.log('Call taken by another doctor:', data);
        const { patientId } = data;
        removeCallRequest(patientId);
    });

    // Call ended
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

    // Online doctors update (for patients)
    socket.on('doctors-online', (doctors) => {
        console.log('Doctors online update received:', doctors);
        updateOnlineDoctorsUI(doctors);
    });

    // Waiting patients update (for doctors)
    socket.on('waiting-patients', (patients) => {
        console.log('Waiting patients update received:', patients);
        updateWaitingPatientsUI(patients);
    });
}

// Helper function to join as user
function joinAsUser() {
    if (socket && socket.connected && userSession.user) {
        console.log('Joining as user:', {
            userId: userSession.user._id,
            userType: userSession.userType,
            userName: userSession.user.name
        });
        
        socket.emit('join-as-user', {
            userId: userSession.user._id,
            userType: userSession.userType,
            userName: userSession.user.name
        });
    }
}

// ------------------ Authentication ------------------

const API_BASE = getApiBaseUrl();

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
        console.log('Attempting patient login to:', API_BASE);
        
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

        showNotification(`Welcome ${data.user.name}`, "success");
        
        const patientNameEl = document.getElementById("patientName");
        if (patientNameEl) {
            patientNameEl.textContent = data.user.name;
        }
        
        // Initialize socket connection
        initializeSocket();
        
        // Wait for socket to connect, then join
        socket.on('connect', () => {
            console.log('Socket connected after patient login, joining...');
            joinAsUser();
        });
        
        // If already connected, join immediately
        if (socket && socket.connected) {
            joinAsUser();
        }
        
        showSection('patient-dashboard');
    } catch (err) {
        console.error("Patient login error:", err);
        showNotification(err.message || "Something went wrong. Please try again!", "error");
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
        console.log('Attempting doctor login to:', API_BASE);
        
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

        showNotification(`Welcome Dr. ${data.user.name}`, "success");
        
        const doctorNameEl = document.getElementById("doctorName");
        if (doctorNameEl) {
            doctorNameEl.textContent = `Dr. ${data.user.name}`;
        }
        
        // Initialize socket connection
        initializeSocket();
        
        // Wait for socket to connect, then join
        socket.on('connect', () => {
            console.log('Socket connected after doctor login, joining...');
            joinAsUser();
        });
        
        // If already connected, join immediately
        if (socket && socket.connected) {
            joinAsUser();
        }
        
        showSection('doctor-dashboard');
    } catch (err) {
        console.error("Doctor login error:", err);
        showNotification(err.message || "Something went wrong. Please try again!", "error");
    }
}

// ---------- Patient Signup ----------
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
        console.error("Patient signup error:", err);
        showNotification(err.message, "error");
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
        console.error("Doctor signup error:", err);
        showNotification(err.message, "error");
    }
}

// ---------- Logout ----------
function logout() {
    if (socket) {
        socket.disconnect();
    }
    
    if (isCallActive) {
        endVideoCall();
    }
    
    userSession = {
        token: null,
        user: null,
        userType: null
    };
    currentUserId = null;
    showNotification("Logged out successfully");
    showSection("home");
}

// ------------------ Video Call Functions ------------------

async function startVideoCall() {
    console.log('Starting video call...');
    
    if (!socket || !userSession.user) {
        showNotification("Please login first", "error");
        return;
    }

    if (!socket.connected) {
        showNotification("Connection lost. Please refresh and try again.", "error");
        return;
    }

    try {
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
        displayLocalVideo();
        
        if (userSession.userType === 'patient') {
            console.log('Sending video call request...');
            socket.emit('request-video-call', {
                patientId: userSession.user._id,
                patientName: userSession.user.name
            });
            
            showNotification("Requesting video call with available doctors...", "info");
            updateVideoCallUI('requesting');
        } else if (userSession.userType === 'doctor') {
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

function displayRemoteVideo() {
    const remoteVideo = document.getElementById("remoteVideo");
    const placeholder = document.getElementById("remoteVideoPlaceholder");
    
    if (remoteVideo && remoteStream) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.style.display = "block";
        if (placeholder) placeholder.style.display = "none";
        
        console.log('Remote video displayed');
        updateConnectionStatus("Call Active");
    }
}

function updateConnectionStatus(status) {
    const statusEl = document.getElementById("connectionStatus");
    if (statusEl) {
        statusEl.innerHTML = `<i class="fas fa-wifi"></i> ${status}`;
    }
}

async function startWebRTCCall(isInitiator) {
    console.log('Starting WebRTC call, initiator:', isInitiator);
    
    try {
        peerConnection = new RTCPeerConnection(rtcConfig);
        
        if (localStream) {
            localStream.getTracks().forEach(track => {
                console.log('Adding track to peer connection');
                peerConnection.addTrack(track, localStream);
            });
        }
        
        peerConnection.ontrack = (event) => {
            console.log("Received remote stream");
            remoteStream = event.streams[0];
            displayRemoteVideo();
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && socket && currentRoomId) {
                console.log("Sending ICE candidate");
                socket.emit('webrtc-ice-candidate', {
                    roomId: currentRoomId,
                    candidate: event.candidate
                });
            }
        };
        
        peerConnection.onconnectionstatechange = () => {
            console.log("Connection state:", peerConnection.connectionState);
            updateConnectionStatus(peerConnection.connectionState);
        };
        
        if (isInitiator) {
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

function endVideoCall() {
    console.log('Ending video call...');
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    remoteStream = null;
    
    if (isCallActive && socket && currentRoomId) {
        socket.emit('end-call', { roomId: currentRoomId });
    }
    
    isCallActive = false;
    currentRoomId = null;
    
    resetVideoCallUI();
    updateConnectionStatus("Disconnected");
}

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

function showIncomingCallDialog(patientId, patientName, requestId) {
    console.log('Showing incoming call dialog for:', patientName);
    
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
    
    setTimeout(() => {
        const stillExists = document.getElementById('incomingCallDialog');
        if (stillExists) {
            console.log('Auto-rejecting call after timeout');
            rejectCall(patientId);
        }
    }, 30000);
}

function removeCallRequest(patientId) {
    const dialog = document.getElementById('incomingCallDialog');
    if (dialog) {
        dialog.remove();
        console.log('Call request dialog removed for patient:', patientId);
    }
}

async function acceptCall(patientId, patientName) {
    console.log('Doctor accepting call from:', patientName);
    
    try {
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
            doctorId: userSession.user._id,
            doctorName: userSession.user.name
        });
        
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

function rejectCall(patientId) {
    console.log('Doctor rejecting call from patient:', patientId);
    
    if (socket) {
        socket.emit('reject-call', {
            patientId: patientId,
            doctorId: userSession.user._id
        });
    }
    
    removeCallRequest(patientId);
    showNotification("Call request rejected", "info");
}

function updateOnlineDoctorsUI(doctors) {
    const container = document.getElementById('onlineDoctorsContainer');
    if (!container) return;
    
    console.log('Updating online doctors UI with:', doctors.length, 'doctors');
    
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

function updateWaitingPatientsUI(patients) {
    const container = document.getElementById('waitingPatientsContainer');
    if (!container) return;
    
    console.log('Updating waiting patients UI with:', patients.length, 'patients');
    
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

// ------------------ Chat Functions ------------------
function sendSymptomMessage() {
    const input = document.getElementById("symptomInput");
    if (!input) return;
    
    const message = input.value.trim();
    if (!message) return;

    appendMessage("user", message);
    input.value = "";

    const loadingMsg = appendMessage("ai", "Analyzing your symptoms...");
    
    // Simulate AI response with typing indicator
    setTimeout(() => {
        if (loadingMsg.parentNode) {
            loadingMsg.remove();
        }
        
        // Simple symptom analysis based on keywords
        const response = generateAIResponse(message);
        appendMessage("ai", response);
    }, 2000);
}

function generateAIResponse(symptoms) {
    const lowerSymptoms = symptoms.toLowerCase();
    
    // Basic symptom matching
    if (lowerSymptoms.includes('headache') || lowerSymptoms.includes('fever')) {
        return "Based on your symptoms of headache and fever, this could indicate a viral infection. I recommend rest, staying hydrated, and monitoring your temperature. If symptoms persist for more than 3 days or worsen, please consult with a healthcare professional. Would you like to schedule a video consultation with one of our doctors?";
    }
    
    if (lowerSymptoms.includes('cough') || lowerSymptoms.includes('sore throat')) {
        return "Your symptoms suggest a possible upper respiratory infection. Try warm fluids, throat lozenges, and get adequate rest. If you develop difficulty breathing or symptoms worsen, seek immediate medical attention. Our doctors are available for video consultations if you need professional guidance.";
    }
    
    if (lowerSymptoms.includes('stomach') || lowerSymptoms.includes('nausea')) {
        return "Digestive symptoms can have various causes. Try the BRAT diet (bananas, rice, applesauce, toast) and stay hydrated with clear fluids. Avoid dairy and fatty foods. If symptoms persist or you experience severe dehydration, please consult a healthcare provider.";
    }
    
    if (lowerSymptoms.includes('chest pain') || lowerSymptoms.includes('difficulty breathing')) {
        return "⚠️ IMPORTANT: Chest pain and breathing difficulties can be serious. If you're experiencing severe chest pain, difficulty breathing, or think you might be having a heart attack, please call emergency services immediately (911). For non-emergency chest discomfort, please consult with a doctor as soon as possible.";
    }
    
    // General response
    return "Thank you for describing your symptoms. While I can provide general health information, I recommend consulting with a qualified healthcare professional for proper diagnosis and treatment. Our certified doctors are available for video consultations. Would you like to connect with a doctor now?";
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendSymptomMessage();
    }
}

function appendMessage(sender, text) {
    const chatBox = document.getElementById("chatMessages");
    if (!chatBox) return null;
    
    const msg = document.createElement("div");
    msg.className = `message ${sender}`;
    msg.innerHTML = `<div class="message-content">${text}</div>`;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
    return msg;
}

// ------------------ Dashboard Functions ------------------
function viewPrescriptions() {
    const prescriptionsView = document.getElementById("prescriptionsView");
    if (prescriptionsView) {
        prescriptionsView.style.display = prescriptionsView.style.display === "none" ? "block" : "none";
    }
}

function downloadPrescription(prescriptionId) {
    // Check if jsPDF is available
    if (typeof window.jsPDF === 'undefined') {
        showNotification("PDF library not loaded. Please refresh the page.", "error");
        return;
    }

    try {
        const { jsPDF } = window.jsPDF;
        const pdf = new jsPDF();
        
        // Add prescription content
        pdf.setFontSize(20);
        pdf.text("Medical Prescription", 20, 30);
        
        pdf.setFontSize(12);
        pdf.text(`Prescription ID: ${prescriptionId}`, 20, 50);
        pdf.text(`Patient: ${userSession.user ? userSession.user.name : 'Patient Name'}`, 20, 65);
        pdf.text(`Date: ${new Date().toLocaleDateString()}`, 20, 80);
        pdf.text("Doctor: Dr. Smith", 20, 95);
        
        pdf.text("Diagnosis: Common Cold", 20, 120);
        pdf.text("Medications:", 20, 140);
        pdf.text("1. Paracetamol 500mg - Every 6 hours for pain/fever", 25, 155);
        pdf.text("2. Rest for 2-3 days", 25, 170);
        pdf.text("3. Increase fluid intake", 25, 185);
        
        pdf.text("Follow-up: Contact if symptoms persist beyond 3 days", 20, 210);
        
        // Save the PDF
        pdf.save(`prescription_${prescriptionId}.pdf`);
        showNotification("Prescription downloaded successfully", "success");
        
    } catch (error) {
        console.error("Error generating PDF:", error);
        showNotification("Error downloading prescription. Please try again.", "error");
    }
}

// ------------------ Doctor Dashboard Functions ------------------
function toggleDoctorStatus() {
    if (!userSession.user || userSession.userType !== 'doctor') {
        showNotification("Access denied. Doctor login required.", "error");
        return;
    }
    
    // Toggle status logic would go here
    showNotification("Doctor status updated", "info");
}

function approvePrescription(prescriptionId) {
    if (!userSession.user || userSession.userType !== 'doctor') {
        showNotification("Access denied. Doctor login required.", "error");
        return;
    }
    
    // Find and remove the prescription card
    const prescriptionCards = document.querySelectorAll('.prescription-card');
    prescriptionCards.forEach(card => {
        if (card.innerHTML.includes(`onclick="approvePrescription('${prescriptionId}')"`) ||
            card.innerHTML.includes(`onclick="rejectPrescription('${prescriptionId}')"`) ||
            card.innerHTML.includes(`onclick="modifyPrescription('${prescriptionId}')"`)
        ) {
            card.style.opacity = '0.5';
            card.innerHTML += '<div style="color: green; font-weight: bold; margin-top: 1rem;">✅ APPROVED</div>';
            
            // Disable action buttons
            const buttons = card.querySelectorAll('button');
            buttons.forEach(btn => btn.disabled = true);
        }
    });
    
    showNotification(`Prescription ${prescriptionId} approved successfully`, "success");
}

function rejectPrescription(prescriptionId) {
    if (!userSession.user || userSession.userType !== 'doctor') {
        showNotification("Access denied. Doctor login required.", "error");
        return;
    }
    
    // Find and update the prescription card
    const prescriptionCards = document.querySelectorAll('.prescription-card');
    prescriptionCards.forEach(card => {
        if (card.innerHTML.includes(`onclick="approvePrescription('${prescriptionId}')"`) ||
            card.innerHTML.includes(`onclick="rejectPrescription('${prescriptionId}')"`) ||
            card.innerHTML.includes(`onclick="modifyPrescription('${prescriptionId}')"`)
        ) {
            card.style.opacity = '0.5';
            card.innerHTML += '<div style="color: red; font-weight: bold; margin-top: 1rem;">❌ REJECTED</div>';
            
            // Disable action buttons
            const buttons = card.querySelectorAll('button');
            buttons.forEach(btn => btn.disabled = true);
        }
    });
    
    showNotification(`Prescription ${prescriptionId} rejected`, "info");
}

function modifyPrescription(prescriptionId) {
    if (!userSession.user || userSession.userType !== 'doctor') {
        showNotification("Access denied. Doctor login required.", "error");
        return;
    }
    
    const newMedication = prompt("Enter modified prescription (or press Cancel):");
    if (newMedication && newMedication.trim()) {
        // Find and update the prescription card
        const prescriptionCards = document.querySelectorAll('.prescription-card');
        prescriptionCards.forEach(card => {
            if (card.innerHTML.includes(`onclick="modifyPrescription('${prescriptionId}')"`) ||
                card.innerHTML.includes(`onclick="approvePrescription('${prescriptionId}')"`)
            ) {
                const medicationList = card.querySelector('.medication-list');
                if (medicationList) {
                    medicationList.innerHTML = `<li><strong>Modified:</strong> ${newMedication}</li>`;
                    card.innerHTML += '<div style="color: orange; font-weight: bold; margin-top: 1rem;">📝 MODIFIED & APPROVED</div>';
                    
                    // Disable action buttons
                    const buttons = card.querySelectorAll('button');
                    buttons.forEach(btn => btn.disabled = true);
                }
            }
        });
        
        showNotification(`Prescription ${prescriptionId} modified and approved`, "success");
    }
}

// ------------------ Helper Functions ------------------
function showPatientSignup() {
    showSection('patient-signup');
}

function showDoctorSignup() {
    showSection('doctor-signup');
}

// ------------------ Contact Form ------------------
function handleContactForm() {
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const name = document.getElementById('name').value;
            const email = document.getElementById('email').value;
            const message = document.getElementById('message').value;
            
            if (name && email && message) {
                showNotification("Thank you for your message! We'll get back to you soon.", "success");
                contactForm.reset();
            } else {
                showNotification("Please fill in all fields", "error");
            }
        });
    }
}

// ------------------ Dark Mode Toggle ------------------
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const darkModeBtn = document.getElementById('darkModeBtn');
    
    if (document.body.classList.contains('dark-mode')) {
        darkModeBtn.innerHTML = '<i class="fas fa-sun"></i>';
        localStorage.setItem('darkMode', 'enabled');
    } else {
        darkModeBtn.innerHTML = '<i class="fas fa-moon"></i>';
        localStorage.setItem('darkMode', 'disabled');
    }
}

// ------------------ Initialize App ------------------
document.addEventListener('DOMContentLoaded', function() {
    console.log('AI Health Mate app initialized');
    
    // Check for saved dark mode preference
    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        const darkModeBtn = document.getElementById('darkModeBtn');
        if (darkModeBtn) {
            darkModeBtn.innerHTML = '<i class="fas fa-sun"></i>';
        }
    }
    
    // Initialize contact form
    handleContactForm();
    
    // Add event listeners for forms
    const patientLoginForm = document.getElementById('patientLoginForm');
    if (patientLoginForm) {
        patientLoginForm.addEventListener('submit', handlePatientLogin);
    }
    
    const doctorLoginForm = document.getElementById('doctorLoginForm');
    if (doctorLoginForm) {
        doctorLoginForm.addEventListener('submit', handleDoctorLogin);
    }
    
    const patientSignupForm = document.getElementById('patientSignupForm');
    if (patientSignupForm) {
        patientSignupForm.addEventListener('submit', handlePatientSignup);
    }
    
    const doctorSignupForm = document.getElementById('doctorSignupForm');
    if (doctorSignupForm) {
        doctorSignupForm.addEventListener('submit', handleDoctorSignup);
    }
    
    // Initialize video call buttons
    const startCallBtn = document.getElementById('startCallBtn');
    if (startCallBtn) {
        startCallBtn.addEventListener('click', startVideoCall);
    }
    
    const endCallBtn = document.getElementById('endCallBtn');
    if (endCallBtn) {
        endCallBtn.addEventListener('click', endVideoCall);
    }
    
    // Show initial section
    showSection('home');
});

// Handle page visibility changes (for mobile devices)
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && socket && !socket.connected) {
        console.log('Page became visible, attempting to reconnect...');
        socket.connect();
    }
});

// Handle online/offline events
window.addEventListener('online', function() {
    console.log('Network connection restored');
    if (socket && !socket.connected) {
        socket.connect();
    }
    showNotification('Network connection restored', 'success');
});

window.addEventListener('offline', function() {
    console.log('Network connection lost');
    showNotification('Network connection lost', 'error');
});
