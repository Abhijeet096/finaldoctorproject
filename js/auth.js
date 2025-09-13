// =======================
// DOCTOR LOGIN
// =======================
async function handleDoctorLogin(event) {
    event.preventDefault(); // prevent page refresh

    const email = document.getElementById('doctorEmail').value;
    const password = document.getElementById('doctorPassword').value;
    const specialty = document.getElementById('specialty').value;

    try {
        const res = await fetch('http://localhost:5000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, role: 'doctor', specialty })
        });

        const data = await res.json();
        if (data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('role', data.user.role);
            alert(`Doctor Login successful! Welcome ${data.user.name}`);
            // TODO: redirect to doctor dashboard
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error(err);
        alert("Something went wrong. Please try again!");
    }
}

// =======================
// PATIENT LOGIN
// =======================
async function handlePatientLogin(event) {
    event.preventDefault();

    const email = document.getElementById('patientEmail').value;
    const password = document.getElementById('patientPassword').value;

    try {
        const res = await fetch('http://localhost:5000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, role: 'patient' })
        });

        const data = await res.json();
        if (data.success) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('role', data.user.role);
            alert(`Patient Login successful! Welcome ${data.user.name}`);
            // TODO: redirect to patient dashboard
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error(err);
        alert("Something went wrong. Please try again!");
    }
}
