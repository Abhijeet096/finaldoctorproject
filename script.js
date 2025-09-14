    // script.js

    // ------------------ Global Variables ------------------
    let socket;
    let localStream;
    let remoteStream;
    let peerConnection;
    let isCallActive = false;
    let currentRoomId = null;
    let currentUserId = null;

    // WebRTC Configuration
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
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

    // With your Render URL (you'll get this after deployment):
const SERVER_BASE = 'https://doctor-project-backend-si7c.onrender.com';


    // ------------------ Socket.IO Initialization ------------------
    function initializeSocket() {
        console.log('Initializing socket connection...');
        socket = io('https://doctor-project-backend-si7c.onrender.com');
        
        socket.on('connect', () => {
            console.log('Connected to server:', socket.id);
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            showNotification('Connection error. Please try again.', 'error');
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
            showNotification(message || `Call rejected`, 'error');
            resetVideoCallUI();
        });

        // Incoming call request (for doctors)
        socket.on('incoming-call-request', (data) => {
            console.log('Incoming call request:', data);
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
            console.log('Doctors online update:', doctors);
            updateOnlineDoctorsUI(doctors);
        });

        // Waiting patients update (for doctors)
        socket.on('waiting-patients', (patients) => {
            console.log('Waiting patients update:', patients);
            updateWaitingPatientsUI(patients);
        });
    }

    // ------------------ Authentication ------------------

    const API_BASE = "https://doctor-project-backend-si7c.onrender.com";

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

            showNotification(`Welcome ${data.user.name}`, "success");
            
            const patientNameEl = document.getElementById("patientName");
            if (patientNameEl) {
                patientNameEl.textContent = data.user.name;
            }
            
            // Initialize socket connection
            initializeSocket();
            
            // Wait for socket to connect before joining
            socket.on('connect', () => {
                console.log('Socket connected, joining as patient...');
                socket.emit('join-as-user', {
                    userId: data.user._id,
                    userType: 'patient',
                    userName: data.user.name
                });
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
            currentUserId = data.user._id;

            showNotification(`Welcome Dr. ${data.user.name}`, "success");
            
            const doctorNameEl = document.getElementById("doctorName");
            if (doctorNameEl) {
                doctorNameEl.textContent = `Dr. ${data.user.name}`;
            }
            
            // Initialize socket connection
            initializeSocket();
            
            // Wait for socket to connect before joining
            socket.on('connect', () => {
                console.log('Socket connected, joining as doctor...');
                socket.emit('join-as-user', {
                    userId: data.user._id,
                    userType: 'doctor',
                    userName: data.user.name
                });
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
        currentUserId = null;
        showNotification("Logged out successfully");
        showSection("home");
    }

    // ------------------ Real-time Video Call Functions ------------------

    // Patient requests video call
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
                doctorId: userSession.user._id,
                doctorName: userSession.user.name
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
                doctorId: userSession.user._id
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

    // ------------------ Chat Functions ------------------
    function sendSymptomMessage() {
        const input = document.getElementById("symptomInput");
        if (!input) return;
        
        const message = input.value.trim();
        if (!message) return;

        appendMessage("user", message);
        input.value = "";

        // Show loading
        const loadingMsg = appendMessage("ai", "Analyzing your symptoms...");
        
        setTimeout(() => {
            if (loadingMsg.parentNode) {
                loadingMsg.remove();
            }
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
        const darkModeBtn = document.getElementById("darkModeBtn");
        if (darkModeBtn) {
            darkModeBtn.innerHTML = isDark ? 
                '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        }
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

    // Initialize app when DOM is loaded
    document.addEventListener('DOMContentLoaded', function() {
        console.log('DOM loaded, initializing app...');
        
        // Initialize notification system
        initializeNotifications();
        
        // Check for existing session (if implementing persistent sessions)
        // This would require storing session info in localStorage or cookies
        
        // Set up periodic connection check
        setInterval(() => {
            if (isLoggedIn() && (!socket || !socket.connected)) {
                console.log('Connection lost, attempting to reconnect...');
                reconnectSocket();
            }
        }, 30000); // Check every 30 seconds
        
        console.log('App initialization complete');
    });


