
        // Global Variables
        let currentUser = null;
        let userType = null;
        let localStream = null;
        let remoteStream = null;
        let peerConnection = null;
        let isCallActive = false;
        let isMuted = false;
        let isCameraOff = false;
        let chatHistory = [];

        // Initialize App
        document.addEventListener('DOMContentLoaded', function() {
            
            initializeApp();
        });

        

        function initializeApp() {
            // Check for existing session
            const savedUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
            const savedUserType = localStorage.getItem('userType');
            
            if (savedUser && savedUserType) {
                currentUser = savedUser;
                userType = savedUserType;
                showDashboard();
            }

            // Initialize form handlers
            setupFormHandlers();
            
            // Load chat history
            loadChatHistory();
            
            showNotification('Welcome to AI Health Mate!', 'success');
        }

        // Navigation Functions
        function showSection(sectionId) {
            // Hide all sections
            const sections = document.querySelectorAll('.section');
            sections.forEach(section => {
                section.classList.remove('active');
            });
            
            // Show selected section
            const targetSection = document.getElementById(sectionId);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        }

        function showDashboard() {
            if (userType === 'patient') {
                document.getElementById('patientName').textContent = currentUser.name || 'Patient';
                showSection('patient-dashboard');
            } else if (userType === 'doctor') {
                document.getElementById('doctorName').textContent = currentUser.name || 'Doctor';
                showSection('doctor-dashboard');
            }
        }

        // Authentication Functions
        function setupFormHandlers() {
            // Contact Form
            document.getElementById('contactForm').addEventListener('submit', function(e) {
                e.preventDefault();
                showNotification('Thank you for your message! We\'ll get back to you soon.', 'success');
                this.reset();
            });

            // Patient Login Form
            document.getElementById('patientLoginForm').addEventListener('submit', function(e) {
                e.preventDefault();
                const email = document.getElementById('patientEmail').value;
                const password = document.getElementById('patientPassword').value;
                
                if (loginUser(email, password, 'patient')) {
                    showNotification('Welcome back!', 'success');
                }
            });

            // Doctor Login Form
            document.getElementById('doctorLoginForm').addEventListener('submit', function(e) {
                e.preventDefault();
                const email = document.getElementById('doctorEmail').value;
                const password = document.getElementById('doctorPassword').value;
                const specialty = document.getElementById('specialty').value;
                
                if (loginUser(email, password, 'doctor', specialty)) {
                    showNotification('Doctor login successful!', 'success');
                }
            });
        }

        function loginUser(email, password, type, specialty = null) {
            // Simulate authentication (replace with real backend call)
            if (email && password) {
                const user = {
                    id: Date.now(),
                    email: email,
                    name: type === 'doctor' ? 'Dr. ' + email.split('@')[0] : email.split('@')[0],
                    specialty: specialty,
                    loginTime: new Date().toISOString()
                };
                
                currentUser = user;
                userType = type;
                
                // Store session
                localStorage.setItem('currentUser', JSON.stringify(user));
                localStorage.setItem('userType', type);
                
                showDashboard();
                return true;
            }
            
            showNotification('Please check your credentials', 'error');
            return false;
        }

        function showPatientSignup() {
            const formContainer = document.querySelector('#patient-login .form-container');
            formContainer.innerHTML = `
                <div style="text-align: center; margin-bottom: 2rem;">
                    <i class="fas fa-user-plus" style="font-size: 4rem; color: var(--primary-color);"></i>
                </div>
                <form id="patientSignupForm">
                    <div class="form-group">
                        <label for="signupName">Full Name</label>
                        <input type="text" id="signupName" required>
                    </div>
                    <div class="form-group">
                        <label for="signupEmail">Email Address</label>
                        <input type="email" id="signupEmail" required>
                    </div>
                    <div class="form-group">
                        <label for="signupPhone">Phone Number</label>
                        <input type="tel" id="signupPhone" required>
                    </div>
                    <div class="form-group">
                        <label for="signupPassword">Password</label>
                        <input type="password" id="signupPassword" required>
                    </div>
                    <div class="form-group">
                        <label for="signupAge">Age</label>
                        <input type="number" id="signupAge" min="1" max="120" required>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-bottom: 1rem;">
                        <i class="fas fa-user-plus"></i> Create Account
                    </button>
                </form>
                <p style="text-align: center;">
                    <a onclick="showSection('patient-login')" style="color: var(--primary-color); cursor: pointer;">Already have an account? Login here</a>
                </p>
            `;
            
            // Add event listener for signup form
            document.getElementById('patientSignupForm').addEventListener('submit', function(e) {
                e.preventDefault();
                showNotification('Account created successfully!', 'success');
                setTimeout(() => showSection('patient-login'), 2000);
            });
        }

        function showDoctorSignup() {
            const formContainer = document.querySelector('#doctor-login .form-container');
            formContainer.innerHTML = `
                <div style="text-align: center; margin-bottom: 2rem;">
                    <i class="fas fa-user-md-plus" style="font-size: 4rem; color: var(--primary-color);"></i>
                </div>
                <form id="doctorSignupForm">
                    <div class="form-group">
                        <label for="doctorSignupName">Full Name</label>
                        <input type="text" id="doctorSignupName" required>
                    </div>
                    <div class="form-group">
                        <label for="doctorSignupEmail">Email Address</label>
                        <input type="email" id="doctorSignupEmail" required>
                    </div>
                    <div class="form-group">
                        <label for="licenseNumber">Medical License Number</label>
                        <input type="text" id="licenseNumber" required>
                    </div>
                    <div class="form-group">
                        <label for="signupSpecialty">Specialty</label>
                        <select id="signupSpecialty" required>
                            <option value="">Select Specialty</option>
                            <option value="general">General Medicine</option>
                            <option value="cardiology">Cardiology</option>
                            <option value="dermatology">Dermatology</option>
                            <option value="pediatrics">Pediatrics</option>
                            <option value="psychiatry">Psychiatry</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="doctorSignupPassword">Password</label>
                        <input type="password" id="doctorSignupPassword" required>
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-bottom: 1rem;">
                        <i class="fas fa-user-plus"></i> Register as Doctor
                    </button>
                </form>
                <p style="text-align: center;">
                    <a onclick="showSection('doctor-login')" style="color: var(--primary-color); cursor: pointer;">Already registered? Login here</a>
                </p>
            `;
            
            // Add event listener for doctor signup form
            document.getElementById('doctorSignupForm').addEventListener('submit', function(e) {
                e.preventDefault();
                showNotification('Doctor registration submitted for verification!', 'success');
                setTimeout(() => showSection('doctor-login'), 2000);
            });
        }

        function logout() {
            currentUser = null;
            userType = null;
            localStorage.removeItem('currentUser');
            localStorage.removeItem('userType');
            showSection('home');
            showNotification('Logged out successfully!', 'success');
        }

        // AI Chat Functions
        function loadChatHistory() {
            chatHistory = JSON.parse(localStorage.getItem('chatHistory') || '[]');
            // Display existing chat if any
            if (chatHistory.length > 1) {
                const chatMessages = document.getElementById('chatMessages');
                chatMessages.innerHTML = '<div class="message ai"><div class="message-content"><p>Hello! I\'m your AI Health Assistant. Please describe your symptoms, and I\'ll provide a preliminary analysis. Remember, this is not a substitute for professional medical advice.</p></div></div>';
                
                chatHistory.slice(1).forEach(message => {
                    displayMessage(message.content, message.type);
                });
            }
        }

        function handleChatKeyPress(event) {
            if (event.key === 'Enter') {
                sendSymptomMessage();
            }
        }

        function sendSymptomMessage() {
            const input = document.getElementById('symptomInput');
            const message = input.value.trim();
            
            if (!message) return;
            
            // Display user message
            displayMessage(message, 'user');
            
            // Clear input
            input.value = '';
            
            // Show loading
            showTypingIndicator();
            
            // Simulate AI processing delay
            setTimeout(() => {
                hideTypingIndicator();
                const aiResponse = generateAIResponse(message);
                displayMessage(aiResponse, 'ai');
                
                // Save to chat history
                chatHistory.push({content: message, type: 'user', timestamp: new Date()});
                chatHistory.push({content: aiResponse, type: 'ai', timestamp: new Date()});
                localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
            }, 2000);
        }

        function displayMessage(content, type) {
            const chatMessages = document.getElementById('chatMessages');
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${type}`;
            
            messageDiv.innerHTML = `
                <div class="message-content">
                    <p>${content}</p>
                    <small style="opacity: 0.7; font-size: 0.8rem;">${new Date().toLocaleTimeString()}</small>
                </div>
            `;
            
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function showTypingIndicator() {
            const chatMessages = document.getElementById('chatMessages');
            const typingDiv = document.createElement('div');
            typingDiv.className = 'message ai';
            typingDiv.id = 'typingIndicator';
            
            typingDiv.innerHTML = `
                <div class="message-content">
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        <span>AI is analyzing...</span>
                    </div>
                </div>
            `;
            
            chatMessages.appendChild(typingDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function hideTypingIndicator() {
            const typingIndicator = document.getElementById('typingIndicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }
        }

        function generateAIResponse(symptoms) {
            // Simulate AI analysis (replace with real AI API call)
            const responses = {
                'headache': {
                    analysis: "Based on your headache symptoms, this could be related to tension, dehydration, or stress.",
                    recommendations: [
                        "Stay hydrated - drink plenty of water",
                        "Get adequate rest (7-8 hours of sleep)",
                        "Consider over-the-counter pain relief if needed",
                        "Try relaxation techniques or gentle neck stretches"
                    ],
                    urgency: "low",
                    followUp: "If headaches persist for more than 3 days or become severe, please consult a doctor."
                },
                'fever': {
                    analysis: "Fever typically indicates your body is fighting an infection. Temperature above 100.4°F (38°C) is considered fever.",
                    recommendations: [
                        "Rest and stay in bed",
                        "Drink plenty of fluids",
                        "Take fever-reducing medication as directed",
                        "Monitor temperature regularly"
                    ],
                    urgency: "medium",
                    followUp: "Seek immediate medical attention if fever exceeds 103°F (39.4°C) or is accompanied by difficulty breathing."
                },
                'cold': {
                    analysis: "Your symptoms suggest a common cold, which is usually caused by a viral infection.",
                    recommendations: [
                        "Get plenty of rest",
                        "Stay hydrated with warm fluids",
                        "Use a humidifier or breathe steam",
                        "Consider throat lozenges for sore throat"
                    ],
                    urgency: "low",
                    followUp: "Cold symptoms typically resolve within 7-10 days. Consult a doctor if symptoms worsen or persist."
                }
            };

            // Simple keyword matching for demo
            const lowerSymptoms = symptoms.toLowerCase();
            let response = null;

            if (lowerSymptoms.includes('headache') || lowerSymptoms.includes('head pain')) {
                response = responses.headache;
            } else if (lowerSymptoms.includes('fever') || lowerSymptoms.includes('temperature')) {
                response = responses.fever;
            } else if (lowerSymptoms.includes('cold') || lowerSymptoms.includes('cough') || lowerSymptoms.includes('runny nose')) {
                response = responses.cold;
            } else {
                // Generic response
                return `I understand you're experiencing: "${symptoms}". While I can provide general health information, it's important to consult with a healthcare professional for proper diagnosis and treatment. Would you like to schedule a video consultation with one of our doctors?`;
            }

            return `
                <strong>Preliminary Analysis:</strong><br>
                ${response.analysis}<br><br>
                
                <strong>Recommendations:</strong><br>
                ${response.recommendations.map(rec => `• ${rec}`).join('<br>')}<br><br>
                
                <strong>Urgency Level:</strong> ${response.urgency.charAt(0).toUpperCase() + response.urgency.slice(1)}<br><br>
                
                <strong>Follow-up:</strong><br>
                ${response.followUp}<br><br>
                
                <em>⚠️ This is an AI-generated assessment and should not replace professional medical advice. Consider scheduling a video consultation for personalized care.</em>
            `;
        }

        // Video Call Functions
        async function startVideoCall() {
            try {
                showNotification('Starting video call...', 'success');
                
                // Request camera and microphone access
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });
                
                // Display local video
                const localVideo = document.createElement('video');
                localVideo.srcObject = localStream;
                localVideo.autoplay = true;
                localVideo.muted = true;
                localVideo.style.width = '100%';
                localVideo.style.height = '300px';
                localVideo.style.borderRadius = '1rem';
                
                const localPlaceholder = document.getElementById('localVideoPlaceholder');
                localPlaceholder.innerHTML = '';
                localPlaceholder.appendChild(localVideo);
                
                // Simulate remote video (in real implementation, this would be WebRTC peer connection)
                simulateRemoteVideo();
                
                // Update UI
                document.getElementById('startCallBtn').style.display = 'none';
                document.getElementById('endCallBtn').style.display = 'inline-block';
                document.getElementById('muteBtn').style.display = 'inline-block';
                document.getElementById('cameraBtn').style.display = 'inline-block';
                
                isCallActive = true;
                showNotification('Video call started successfully!', 'success');
                
            } catch (error) {
                showNotification('Unable to access camera/microphone. Please check permissions.', 'error');
                console.error('Error starting video call:', error);
            }
        }

        function simulateRemoteVideo() {
            // In a real implementation, this would be the remote peer's video stream
            const remotePlaceholder = document.getElementById('remoteVideoPlaceholder');
            remotePlaceholder.innerHTML = `
                <div style="background: linear-gradient(45deg, #667eea, #764ba2); color: white; padding: 4rem 2rem; border-radius: 1rem; height: 300px; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                    <i class="fas fa-user-md" style="font-size: 4rem; margin-bottom: 1rem;"></i>
                    <h4>Dr. Smith</h4>
                    <p>Connected</p>
                    <div style="margin-top: 1rem;">
                        <div style="width: 12px; height: 12px; background: #10b981; border-radius: 50%; display: inline-block; margin-right: 0.5rem;"></div>
                        <span>Online</span>
                    </div>
                </div>
            `;
        }

        function endVideoCall() {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            
            // Reset UI
            document.getElementById('localVideoPlaceholder').innerHTML = `
                <i class="fas fa-user"></i>
                <p>Your Video</p>
                <small>Camera access required</small>
            `;
            
            document.getElementById('remoteVideoPlaceholder').innerHTML = `
                <i class="fas fa-user-md"></i>
                <p>Doctor's Video</p>
                <small>Waiting for connection</small>
            `;
            
            document.getElementById('startCallBtn').style.display = 'inline-block';
            document.getElementById('endCallBtn').style.display = 'none';
            document.getElementById('muteBtn').style.display = 'none';
            document.getElementById('cameraBtn').style.display = 'none';
            
            isCallActive = false;
            isMuted = false;
            isCameraOff = false;
            
            showNotification('Video call ended', 'success');
        }

        function toggleMute() {
            if (!localStream) return;
            
            const audioTracks = localStream.getAudioTracks();
            if (audioTracks.length > 0) {
                audioTracks[0].enabled = !audioTracks[0].enabled;
                isMuted = !isMuted;
                
                const muteBtn = document.getElementById('muteBtn');
                if (isMuted) {
                    muteBtn.innerHTML = '<i class="fas fa-microphone-slash"></i> Unmute';
                    muteBtn.style.background = 'var(--danger-color)';
                    muteBtn.style.color = 'white';
                } else {
                    muteBtn.innerHTML = '<i class="fas fa-microphone"></i> Mute';
                    muteBtn.style.background = '';
                    muteBtn.style.color = '';
                }
            }
        }

        function toggleCamera() {
            if (!localStream) return;
            
            const videoTracks = localStream.getVideoTracks();
            if (videoTracks.length > 0) {
                videoTracks[0].enabled = !videoTracks[0].enabled;
                isCameraOff = !isCameraOff;
                
                const cameraBtn = document.getElementById('cameraBtn');
                if (isCameraOff) {
                    cameraBtn.innerHTML = '<i class="fas fa-video-slash"></i> Camera On';
                    cameraBtn.style.background = 'var(--danger-color)';
                    cameraBtn.style.color = 'white';
                } else {
                    cameraBtn.innerHTML = '<i class="fas fa-video"></i> Camera Off';
                    cameraBtn.style.background = '';
                    cameraBtn.style.color = '';
                }
            }
        }

        // Prescription Functions
        function viewPrescriptions() {
            const prescriptionsView = document.getElementById('prescriptionsView');
            prescriptionsView.style.display = prescriptionsView.style.display === 'none' ? 'block' : 'none';
        }

        function downloadPrescription(prescriptionId) {
            try {
                // Create PDF using jsPDF
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF();
                
                // Add content to PDF
                doc.setFontSize(20);
                doc.text('AI Health Mate - Prescription', 20, 20);
                
                doc.setFontSize(12);
                doc.text(`Prescription ID: ${prescriptionId}`, 20, 40);
                doc.text(`Patient: ${currentUser?.name || 'Patient Name'}`, 20, 50);
                doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 60);
                doc.text(`Doctor: Dr. Smith`, 20, 70);
                
                doc.text('Diagnosis: Common Cold', 20, 90);
                doc.text('Medications:', 20, 110);
                doc.text('• Paracetamol 500mg - Take 1 tablet every 6 hours', 30, 120);
                doc.text('• Vitamin C 1000mg - Take 1 tablet daily', 30, 130);
                doc.text('• Rest and hydration - Drink plenty of fluids', 30, 140);
                
                doc.text('Instructions: Take medications as prescribed. Rest for 3-5 days.', 20, 160);
                
                doc.text('This prescription is digitally generated and verified.', 20, 180);
                
                // Save PDF
                doc.save(`prescription-${prescriptionId}.pdf`);
                showNotification('Prescription downloaded successfully!', 'success');
                
            } catch (error) {
                showNotification('Error generating PDF. Please try again.', 'error');
                console.error('PDF generation error:', error);
            }
        }

        function approvePrescription(prescriptionId) {
            showNotification('Prescription approved successfully!', 'success');
            // In real implementation, this would update the database
            document.querySelector('.prescription-card').style.opacity = '0.6';
            document.querySelector('.prescription-card .prescription-header').innerHTML += '<span style="color: var(--secondary-color); font-weight: bold; margin-left: 1rem;">✓ APPROVED</span>';
        }

        function rejectPrescription(prescriptionId) {
            showNotification('Prescription rejected. Patient will be notified.', 'error');
            document.querySelector('.prescription-card').style.opacity = '0.6';
            document.querySelector('.prescription-card .prescription-header').innerHTML += '<span style="color: var(--danger-color); font-weight: bold; margin-left: 1rem;">✗ REJECTED</span>';
        }

        function modifyPrescription(prescriptionId) {
            showNotification('Opening prescription editor...', 'success');
            // In real implementation, this would open a form to modify the prescription
        }

        function toggleDoctorStatus() {
            const statusButton = document.querySelector('#doctor-dashboard .btn-outline');
            const statusIndicator = document.querySelector('#doctor-dashboard .dashboard-card div');
            
            if (statusButton.innerHTML.includes('Go Offline')) {
                statusButton.innerHTML = '<i class="fas fa-power-off"></i> Go Online';
                statusIndicator.innerHTML = '<div style="width: 12px; height: 12px; background: var(--danger-color); border-radius: 50%;"></div><span>Offline - Unavailable</span>';
                showNotification('You are now offline', 'error');
            } else {
                statusButton.innerHTML = '<i class="fas fa-power-off"></i> Go Offline';
                statusIndicator.innerHTML = '<div style="width: 12px; height: 12px; background: var(--secondary-color); border-radius: 50%;"></div><span>Online - Available</span>';
                showNotification('You are now online', 'success');
            }
        }

        // Utility Functions
        function showNotification(message, type = 'success') {
            const notification = document.getElementById('notification');
            notification.textContent = message;
            notification.className = `notification ${type}`;
            notification.classList.add('show');
            
            setTimeout(() => {
                notification.classList.remove('show');
            }, 4000);
        }

        function toggleDarkMode() {
            document.body.classList.toggle('dark-mode');
            const darkModeBtn = document.getElementById('darkModeBtn');
            
            if (document.body.classList.contains('dark-mode')) {
                darkModeBtn.innerHTML = '<i class="fas fa-sun"></i>';
                localStorage.setItem('darkMode', 'true');
            } else {
                darkModeBtn.innerHTML = '<i class="fas fa-moon"></i>';
                localStorage.setItem('darkMode', 'false');
            }
        }

        // Load dark mode preference
        if (localStorage.getItem('darkMode') === 'true') {
            document.body.classList.add('dark-mode');
            document.getElementById('darkModeBtn').innerHTML = '<i class="fas fa-sun"></i>';
        }

        // Additional utility functions for future backend integration
        async function callAIAPI(symptoms) {
            // Placeholder for real AI API call
            // return await fetch('/api/ai/analyze', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ symptoms })
            // });
        }

        async function saveToDatabase(data, endpoint) {
            // Placeholder for database operations
            // return await fetch(`/api/${endpoint}`, {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify(data)
            // });
            console.log('Data to save:', data, 'Endpoint:', endpoint);
        }

        async function authenticateUser(credentials, userType) {
            // Placeholder for real authentication
            // return await fetch('/api/auth/login', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ ...credentials, userType })
            // });
            console.log('Authenticating user:', credentials, userType);
        }

        // WebRTC Configuration (for real implementation)
        const rtcConfiguration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        async function setupWebRTC() {
            // Real WebRTC implementation would go here
            // peerConnection = new RTCPeerConnection(rtcConfiguration);
            // ... WebRTC setup code
        }

        // Search and Filter Functions for Doctor Dashboard
        function searchPatients(query) {
            // Placeholder for patient search functionality
            console.log('Searching patients:', query);
        }

        function filterPrescriptions(status) {
            // Placeholder for prescription filtering
            console.log('Filtering prescriptions by status:', status);
        }

        // Health Data Visualization (placeholder for charts)
        function generateHealthChart(data) {
            // Placeholder for health data visualization
            // Could integrate with Chart.js or D3.js
            console.log('Generating health chart with data:', data);
        }

        // Appointment Scheduling Functions
        function scheduleAppointment(doctorId, dateTime) {
            // Placeholder for appointment scheduling
            console.log('Scheduling appointment with doctor:', doctorId, 'at:', dateTime);
            showNotification('Appointment scheduled successfully!', 'success');
        }

        function cancelAppointment(appointmentId) {
            // Placeholder for appointment cancellation
            console.log('Cancelling appointment:', appointmentId);
            showNotification('Appointment cancelled', 'success');
        }

        // Medical Records Functions
        function uploadMedicalRecord(file) {
            // Placeholder for file upload
            console.log('Uploading medical record:', file.name);
            showNotification('Medical record uploaded successfully!', 'success');
        }

        function downloadMedicalRecord(recordId) {
            // Placeholder for downloading medical records
            console.log('Downloading medical record:', recordId);
        }

        // Emergency Functions
        function triggerEmergencyAlert() {
            showNotification('Emergency services have been contacted!', 'error');
            // In real implementation, this would contact emergency services
        }

        function findNearestHospital() {
            // Placeholder for location-based hospital search
            showNotification('Finding nearest hospitals...', 'success');
        }

        // Health Monitoring Functions
        function trackVitalSigns(vitals) {
            // Placeholder for vital signs tracking
            console.log('Tracking vital signs:', vitals);
        }

        function setMedicationReminder(medication, time) {
            // Placeholder for medication reminders
            console.log('Setting reminder for:', medication, 'at:', time);
            showNotification('Medication reminder set!', 'success');
        }

        // Insurance and Billing Functions
        function processInsuranceClaim(claimData) {
            // Placeholder for insurance processing
            console.log('Processing insurance claim:', claimData);
        }

        function generateBill(services) {
            // Placeholder for bill generation
            console.log('Generating bill for services:', services);
        }

        // Data Export Functions
        function exportHealthData(format) {
            // Placeholder for data export
            console.log('Exporting health data in format:', format);
            showNotification(`Health data exported as ${format}!`, 'success');
        }

        // Telemedicine Integration Functions
        function connectToPharmacy(prescriptionId) {
            // Placeholder for pharmacy integration
            console.log('Connecting to pharmacy for prescription:', prescriptionId);
            showNotification('Connected to pharmacy for prescription fulfillment!', 'success');
        }

        function orderMedication(medicationList) {
            // Placeholder for medication ordering
            console.log('Ordering medications:', medicationList);
        }

        // AI Enhancement Functions
        function improveAIModel(feedback) {
            // Placeholder for AI model improvement based on user feedback
            console.log('Improving AI model with feedback:', feedback);
        }

        function getAIInsights(patientHistory) {
            // Placeholder for AI-driven health insights
            console.log('Generating AI insights for patient history:', patientHistory);
        }

        // Quality Assurance Functions
        function rateDoctorConsultation(doctorId, rating, feedback) {
            // Placeholder for doctor rating system
            console.log('Rating doctor:', doctorId, 'Rating:', rating, 'Feedback:', feedback);
            showNotification('Thank you for your feedback!', 'success');
        }

        function reportIssue(issueType, description) {
            // Placeholder for issue reporting
            console.log('Reporting issue:', issueType, description);
            showNotification('Issue reported successfully. We\'ll look into it!', 'success');
        }

        // Performance Monitoring
        function trackUserEngagement(action, duration) {
            // Placeholder for analytics
            console.log('User engagement:', action, 'Duration:', duration);
        }

        // Initialize performance tracking
        window.addEventListener('load', function() {
            console.log('AI Health Mate application loaded successfully');
            trackUserEngagement('app_load', Date.now());
        });

        // Handle page visibility for call management
        document.addEventListener('visibilitychange', function() {
            if (document.hidden && isCallActive) {
                showNotification('Call continues in background', 'success');
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            // Ctrl+D for dashboard
            if (e.ctrlKey && e.key === 'd') {
                e.preventDefault();
                if (currentUser) {
                    showDashboard();
                }
            }
            
            // Ctrl+C for chat
            if (e.ctrlKey && e.key === 'c') {
                e.preventDefault();
                showSection('ai-chat');
            }
            
            // Escape to end call
            if (e.key === 'Escape' && isCallActive) {
                endVideoCall();
            }
        });

        // Service Worker Registration (for offline functionality)
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
                // navigator.serviceWorker.register('/sw.js');
                console.log('Service worker support detected');
            });
        }

        // Responsive navigation for mobile
        function toggleMobileMenu() {
            const navLinks = document.querySelector('.nav-links');
            navLinks.classList.toggle('mobile-active');
        }

        // Add mobile menu button functionality
        if (window.innerWidth <= 768) {
            const navContainer = document.querySelector('.nav-container');
            const mobileMenuBtn = document.createElement('button');
            mobileMenuBtn.innerHTML = '<i class="fas fa-bars"></i>';
            mobileMenuBtn.className = 'mobile-menu-btn';
            mobileMenuBtn.onclick = toggleMobileMenu;
            mobileMenuBtn.style.cssText = `
                background: none;
                border: none;
                font-size: 1.5rem;
                color: var(--primary-color);
                cursor: pointer;
                display: block;
            `;
            navContainer.appendChild(mobileMenuBtn);
        }

        // Voice Recognition for Symptom Input (experimental)
        function startVoiceInput() {
            if ('speechRecognition' in window || 'webkitSpeechRecognition' in window) {
                const recognition = new (window.speechRecognition || window.webkitSpeechRecognition)();
                recognition.continuous = false;
                recognition.interimResults = false;
                recognition.lang = 'en-US';
                
                recognition.onresult = function(event) {
                    const transcript = event.results[0][0].transcript;
                    document.getElementById('symptomInput').value = transcript;
                    showNotification('Voice input captured!', 'success');
                };
                
                recognition.onerror = function(event) {
                    showNotification('Voice recognition error', 'error');
                };
                
                recognition.start();
                showNotification('Listening... Please speak now', 'success');
            } else {
                showNotification('Voice recognition not supported in this browser', 'error');
            }
        }

        // Enhanced error handling
        window.addEventListener('error', function(e) {
            console.error('Application error:', e.error);
            showNotification('An error occurred. Please refresh the page if issues persist.', 'error');
        });

        // Cleanup functions
        window.addEventListener('beforeunload', function() {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
            if (peerConnection) {
                peerConnection.close();
            }
        });

        console.log('AI Health Mate initialized successfully!');
        console.log('Ready for backend integration with Node.js and MongoDB');

// new things from chatgpt
      