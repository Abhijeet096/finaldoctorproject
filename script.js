// script.js

// ------------------ Global Variables ------------------
let socket;
let localStream;
let remoteStream;
let peerConnection;
let isCallActive = false;
let currentRoomId = null;

// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
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

// ------------------ Socket.IO Initialization ------------------
function initializeSocket() {
    socket = io('http://localhost:5000');
    
    socket.on('connect', () => {
        console.log('Connected to server:', socket.id);
    });

    // Patient receives call acceptance
    socket.on('call-accepted', (data) => {
        const { roomId, doctorName, doctorId } = data;
        currentRoomId = roomId;
        showNotification(`Dr. ${doctorName} accepted your call!`, 'success');
        updateVideoCallUI('call-accepted');
        startWebRTCCall(true); // Patient initiates the call
    });

    // Doctor receives call start notification
    socket.on('call-started', (data) => {
        const { roomId, patientId, patientName } = data;
        currentRoomId = roomId;
        showNotification(`Call started with ${patientName}`, 'success');
        updateVideoCallUI('call-started');
    });

    // Call rejected
    socket.on('call-rejected', (data) => {
        const { doctorName } = data;
        showNotification(`Dr. ${doctorName} is busy right now`, 'error');
        resetVideoCallUI();
    });

    // Incoming call request (for doctors)
    socket.on('incoming-call-request', (data) => {
        const { patientId, patientName, requestId } = data;
        showIncomingCallDialog(patientId, patientName, requestId);
    });

    // Call was taken by another doctor
    socket.on('call-taken', (data) => {
        const { patientId } = data;
        removeCallRequest(patientId);
    });

    // Call ended
    socket.on('call-ended', () => {
        endVideoCall();
        showNotification('Call ended', 'info');
    });

    // WebRTC signaling events
    socket.on('webrtc-offer', async (data) => {
        const { offer, from } = data;
        await handleWebRTCOffer(offer);
    });

    socket.on('webrtc-answer', async (data) => {
        const { answer, from } = data;
        await handleWebRTCAnswer(answer);
    });

    socket.on('webrtc-ice-candidate', async (data) => {
        const { candidate, from } = data;
        await handleICECandidate(candidate);
    });

    // Online doctors update (for patients)
    socket.on('doctors-online', (doctors) => {
        updateOnlineDoctorsUI(doctors);
    });

    // Waiting patients update (for doctors)
    socket.on('waiting-patients', (patients) => {
        updateWaitingPatientsUI(patients);
    });
}

// ------------------ Authentication (using in-memory storage) ------------------

const API_BASE = "http://localhost:5000/api/auth";

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

        showNotification(`Welcome ${data.user.name}`, "success");
        
        const patientNameEl = document.getElementById("patientName");
        if (patientNameEl) {
            patientNameEl.textContent = data.user.name;
        }
        
        // Initialize socket connection
        initializeSocket();
        
        // Join as patient
        socket.emit('join-as-user', {
            userId: data.user._id,
            userType: 'patient',
            userName: data.user.name
        });
        
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

        showNotification(`Welcome Dr. ${data.user.name}`, "success");
        
        const doctorNameEl = document.getElementById("doctorName");
        if (doctorNameEl) {
            doctorNameEl.textContent = `Dr. ${data.user.name}`;
        }
        
        // Initialize socket connection
        initializeSocket();
        
        // Join as doctor
        socket.emit('join-as-user', {
            userId: data.user._id,
            userType: 'doctor',
            userName: data.user.name
        });
        
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
    showNotification("Logged out successfully");
    showSection("home");
}

// ------------------ Real-time Video Call Functions ------------------

// Patient requests video call
async function startVideoCall() {
    if (!socket || !userSession.user) {
        showNotification("Please login first", "error");
        return;
    }

    if (userSession.userType !== 'patient') {
        showNotification("Only patients can initiate calls", "error");
        return;
    }

    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        
        // Show local video
        displayLocalVideo();
        
        // Request call to doctors
        socket.emit('request-video-call', {
            patientId: userSession.user._id,
            patientName: userSession.user.name
        });
        
        showNotification("Requesting video call with available doctors...", "info");
        updateVideoCallUI('requesting');
        
    } catch (err) {
        console.error("Video call error:", err);
        showNotification("Could not access camera/microphone", "error");
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
    }
}

// Display remote video stream
function displayRemoteVideo() {
    const remoteVideo = document.getElementById("remoteVideo");
    const placeholder = document.getElementById("remoteVideoPlaceholder");
    
    if (remoteVideo && remoteStream) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.style.display = "block";
        if (placeholder) placeholder.style.display = "none";
    }
}

// Start WebRTC connection
async function startWebRTCCall(isInitiator) {
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    // Add local stream to peer connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
    
    // Handle remote stream
    peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        displayRemoteVideo();
    };
    
    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket && currentRoomId) {
            socket.emit('webrtc-ice-candidate', {
                roomId: currentRoomId,
                candidate: event.candidate
            });
        }
    };
    
    if (isInitiator) {
        // Create offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.emit('webrtc-offer', {
            roomId: currentRoomId,
            offer: offer
        });
    }
    
    isCallActive = true;
}

// Handle WebRTC offer
async function handleWebRTCOffer(offer) {
    if (!peerConnection) {
        await startWebRTCCall(false);
    }
    
    await peerConnection.setRemoteDescription(offer);
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('webrtc-answer', {
        roomId: currentRoomId,
        answer: answer
    });
}

// Handle WebRTC answer
async function handleWebRTCAnswer(answer) {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(answer);
    }
}

// Handle ICE candidate
async function handleICECandidate(candidate) {
    if (peerConnection) {
        await peerConnection.addIceCandidate(candidate);
    }
}

// End video call
function endVideoCall() {
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
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
    showNotification("Call ended", "info");
}

// Update video call UI based on state
function updateVideoCallUI(state) {
    const startBtn = document.getElementById("startCallBtn");
    const endBtn = document.getElementById("endCallBtn");
    const muteBtn = document.getElementById("muteBtn");
    const cameraBtn = document.getElementById("cameraBtn");
    
    switch(state) {
        case 'requesting':
            startBtn.style.display = "none";
            endBtn.style.display = "inline-block";
            endBtn.innerHTML = '<i class="fas fa-times"></i> Cancel Request';
            muteBtn.style.display = "inline-block";
            cameraBtn.style.display = "inline-block";
            break;
            
        case 'call-accepted':
        case 'call-started':
            startBtn.style.display = "none";
            endBtn.style.display = "inline-block";
            endBtn.innerHTML = '<i class="fas fa-phone-slash"></i> End Call';
            muteBtn.style.display = "inline-block";
            cameraBtn.style.display = "inline-block";
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
    
    if (localVideo) localVideo.style.display = "none";
    if (remoteVideo) remoteVideo.style.display = "none";
    if (localPlaceholder) localPlaceholder.style.display = "block";
    if (remotePlaceholder) remotePlaceholder.style.display = "block";
}

// Toggle mute/unmute
function toggleMute() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            document.getElementById("muteBtn").innerHTML = audioTrack.enabled ? 
                '<i class="fas fa-microphone"></i> Mute' : 
                '<i class="fas fa-microphone-slash"></i> Unmute';
        }
    }
}

// Toggle camera on/off
function toggleCamera() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            document.getElementById("cameraBtn").innerHTML = videoTrack.enabled ? 
                '<i class="fas fa-video"></i> Camera' : 
                '<i class="fas fa-video-slash"></i> Camera';
        }
    }
}

// Show incoming call dialog for doctors
function showIncomingCallDialog(patientId, patientName, requestId) {
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
                <i class="fas fa-video"></i>
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
}

// Remove call request dialog
function removeCallRequest(patientId) {
    const dialog = document.getElementById('incomingCallDialog');
    if (dialog) {
        dialog.remove();
    }
}

// Doctor accepts call
async function acceptCall(patientId, patientName) {
    try {
        // Get user media
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        
        displayLocalVideo();
        
        socket.emit('accept-call', {
            patientId: patientId,
            doctorId: userSession.user._id,
            doctorName: userSession.user.name
        });
        
        // Remove dialog
        removeCallRequest(patientId);
        
        showNotification(`Accepted call from ${patientName}`, 'success');
        updateVideoCallUI('call-started');
        
    } catch (err) {
        console.error("Error accepting call:", err);
        showNotification("Could not access camera/microphone", "error");
    }
}

// Doctor rejects call
function rejectCall(patientId) {
    socket.emit('reject-call', {
        patientId: patientId,
        doctorId: userSession.user._id
    });
    
    removeCallRequest(patientId);
    showNotification("Call request rejected", "info");
}

// Update online doctors UI for patients
function updateOnlineDoctorsUI(doctors) {
    const container = document.getElementById('onlineDoctorsContainer');
    if (!container) return;
    
    container.innerHTML = `
        <h4><i class="fas fa-user-md"></i> Available Doctors (${doctors.length})</h4>
        ${doctors.map(doctor => `
            <div class="doctor-item">
                <div class="doctor-info">
                    <i class="fas fa-circle ${doctor.status === 'online' ? 'online' : 'busy'}"></i>
                    ${doctor.name}
                </div>
                <span class="doctor-status">${doctor.status}</span>
            </div>
        `).join('')}
    `;
}

// Update waiting patients UI for doctors
function updateWaitingPatientsUI(patients) {
    const container = document.getElementById('waitingPatientsContainer');
    if (!container) return;
    
    container.innerHTML = `
        <h4><i class="fas fa-clock"></i> Waiting Patients (${patients.length})</h4>
        ${patients.map(patient => `
            <div class="patient-item">
                <div class="patient-info">
                    <i class="fas fa-user"></i>
                    ${patient.name}
                </div>
                <button onclick="acceptCall('${patient.id}', '${patient.name}')" class="btn btn-sm btn-primary">
                    Accept Call
                </button>
            </div>
        `).join('')}
    `;
}

// ------------------ Chat Functions ------------------
function sendSymptomMessage() {
    const input = document.getElementById("symptomInput");
    const message = input.value.trim();
    if (!message) return;

    appendMessage("user", message);
    input.value = "";

    // Show loading
    const loadingMsg = appendMessage("ai", "Analyzing your symptoms...");
    
    setTimeout(() => {
        loadingMsg.remove();
        appendMessage("ai", "Based on your symptoms, I recommend rest and hydration. However, please consult with a healthcare professional for proper diagnosis. Would you like to schedule a video consultation?");
    }, 2000);
}

function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendSymptomMessage();
    }
}

function appendMessage(sender, text) {
    const chatBox = document.getElementById("chatMessages");
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
    showNotification("Prescriptions loaded", "success");
}

function downloadPrescription(id) {
    showNotification(`Prescription ${id} downloaded`, "success");
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
    document.getElementById("darkModeBtn").innerHTML = isDark ? 
        '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
}

// ------------------ Contact Form ------------------
document.addEventListener('DOMContentLoaded', function() {
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            showNotification("Message sent successfully! We'll get back to you soon.", "success");
            contactForm.reset();
        });
    }
});
