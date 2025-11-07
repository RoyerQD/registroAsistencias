// ==================== CONFIGURACIÓN ====================
const STORAGE_KEY = 'attendance_db';
const STUDENTS_DATA_URL = 'estudiantes.json';
let attendanceList = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
let studentsDB = [];
let videoStream = null;
let scanning = false;

// ==================== INICIALIZACION ====================
async function init() {
    // Cargar base de datos de estudiantes
    try {
        const response = await fetch(STUDENTS_DATA_URL);
        studentsDB = await response.json();
        console.log('Base de estudiantes cargada:', studentsDB.length);
    } catch (error) {
        console.error('Error cargando estudiantes:', error);
        showToast('No se pudo cargar base de estudiantes', 'error');
        studentsDB = [];
    }

    updateStats();
    renderList();
}

// ==================== UTILS ====================
const $ = id => document.getElementById(id);
const showToast = (msg, type = 'success') => {
    const toast = $('toast');
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
};

const getToday = () => new Date().toISOString().split('T')[0];
const formatDate = (date) => new Date(date).toLocaleString('es-ES');

// ==================== TABS Y FORMULARIOS ====================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        $(`${btn.dataset.tab}-tab`).classList.add('active');
        
        if (btn.dataset.tab !== 'qr') stopCamera();
    });
});

// Selector de tipo de persona
document.querySelectorAll('input[name="personType"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        document.querySelectorAll('.person-form').forEach(f => f.classList.remove('active'));
        if (e.target.value === 'estudiante') {
            $('student-form').classList.add('active');
        } else {
            $('visitor-form').classList.add('active');
        }
    });
});

// ==================== QR SCANNER ====================
let video = $('video');
let canvas = $('canvas');
let ctx = canvas.getContext('2d');

$('start-camera').addEventListener('click', startCamera);

async function startCamera() {
    try {
        const constraints = { 
            video: { 
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        videoStream = stream;
        scanning = true;
        scanQRCode();
        showToast('Cámara iniciada. Escaneando...');
    } catch (err) {
        showToast(`Error camara: ${err.message}`, 'error');
    }
}

function stopCamera() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        scanning = false;
    }
}

function scanQRCode() {
    if (!scanning) return;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
            handleScannedCode(code.data);
            scanning = false; // Pausar escaneo para evitar múltiples lecturas
            setTimeout(() => scanning = true, 2000);
        }
    }

    requestAnimationFrame(scanQRCode);
}

function handleScannedCode(qrData) {
    // Intentar encontrar estudiante por código
    const student = studentsDB.find(s => s.codigo === qrData);
    
    if (student) {
        //Es estudiante registrado
        registerAttendance({
            tipo: 'estudiante',
            codigo: student.codigo,
            nombre: `${student.nombre} ${student.apellidos}`,
            dni: student.dni,
            correo: student.correo
        });
        showQRMessage(`Estudiante: ${student.nombre} ${student.apellidos}`, 'success');
    } else {
        // Es visitante - abrir modal rápido
        $('quickQrcode').value = qrData;
        $('quickNombre').value = '';
        $('quickDni').value = '';
        $('quickMotivo').value = '';
        $('quick-visitor-modal').classList.remove('hidden');
        showQRMessage('Código no registrado. Complete datos de visitante.');
    }
}

function showQRMessage(text, type = '') {
    const msg = $('qr-message');
    msg.textContent = text;
    msg.className = 'message ' + type;
}

// ==================== FORMULARIO VISITANTE RAPIDO ====================
function closeQuickModal() {
    $('quick-visitor-modal').classList.add('hidden');
    $('qr-message').textContent = 'Apunta la cámara al código QR';
    scanning = true;
}

$('quick-visitor-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const data = {
        tipo: 'visitante',
        codigo: $('quickQrcode').value,
        nombre: $('quickNombre').value.trim(),
        dni: $('quickDni').value.trim(),
        correo: '',
        motivo: $('quickMotivo').value.trim()
    };

    if (!data.nombre || !data.dni) {
        showToast('Nombre y DNI son obligatorios', 'error');
        return;
    }

    registerAttendance(data);
    closeQuickModal();
});

// ==================== FORMULARIO ESTUDIANTE MANUAL ====================
$('studentCode').addEventListener('input', (e) => {
    const code = e.target.value.toUpperCase();
    const student = studentsDB.find(s => s.codigo === code);
    const preview = $('student-data');
    
    if (student) {
        preview.innerHTML = `
            <h4>Datos del estudiante:</h4>
            <p><strong>Nombre:</strong> ${student.nombre} ${student.apellidos}</p>
            <p><strong>DNI:</strong> ${student.dni}</p>
            <p><strong>Correo:</strong> ${student.correo}</p>
        `;
        preview.classList.remove('hidden');
    } else if (code.length >= 3) {
        preview.innerHTML = `<p style="color: red;">Codigo no encontrado en base de datos</p>`;
        preview.classList.remove('hidden');
    } else {
        preview.classList.add('hidden');
    }
});

$('student-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const code = $('studentCode').value.toUpperCase();
    const student = studentsDB.find(s => s.codigo === code);
    
    if (!student) {
        showToast('Codigo de estudiante no válido', 'error');
        return;
    }

    // Verificar si ya registrado hoy
    const today = getToday();
    const existing = attendanceList.find(a => 
        a.tipo === 'estudiante' && a.codigo === code && a.date === today
    );
    
    if (existing) {
        showToast('Este estudiante ya registró asistencia hoy', 'error');
        return;
    }

    registerAttendance({
        tipo: 'estudiante',
        codigo: student.codigo,
        nombre: `${student.nombre} ${student.apellidos}`,
        dni: student.dni,
        correo: student.correo
    });
    
    $('student-form').reset();
    $('student-data').classList.add('hidden');
});

// ==================== FORMULARIO VISITANTE MANUAL ====================
$('visitor-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const data = {
        tipo: 'visitante',
        codigo: `VIS${Date.now()}`, // Codigo generado automáticamente
        nombre: $('visitorNombre').value.trim(),
        dni: $('visitorDni').value.trim(),
        correo: $('visitorCorreo').value.trim(),
        motivo: $('visitorMotivo').value.trim()
    };

    if (!data.nombre || !data.dni) {
        showToast('Nombre y DNI son obligatorios', 'error');
        return;
    }

    registerAttendance(data);
    $('visitor-form').reset();
});

// ==================== REGISTRO DE ASISTENCIA ====================
function registerAttendance(person) {
    const today = getToday();
    const timestamp = new Date().toISOString();
    
    // Verificar duplicados
    const isDuplicate = attendanceList.some(a => 
        a.date === today && 
        ((a.tipo === 'estudiante' && a.codigo === person.codigo) ||
         (a.tipo === 'visitante' && a.dni === person.dni))
    );
    
    if (isDuplicate) {
        showToast('Persona ya registrada hoy', 'error');
        return;
    }

    attendanceList.push({
        ...person,
        date: today,
        timestamp: timestamp
    });

    saveData();
    updateStats();
    renderList();
    showToast(`${person.tipo === 'estudiante' ? 'Estudiante' : 'Visitante'} registrado: ${person.nombre}`);
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attendanceList));
}

function updateStats() {
    const today = getToday();
    const todayData = attendanceList.filter(a => a.date === today);
    
    const students = todayData.filter(a => a.tipo === 'estudiante').length;
    const visitors = todayData.filter(a => a.tipo === 'visitante').length;
    
    $('studentCount').textContent = students;
    $('visitorCount').textContent = visitors;
    $('todayCount').textContent = todayData.length;
}

// ==================== LISTA Y FILTRADO ====================
$('filter-date').value = getToday();
$('filter-date').addEventListener('change', renderList);
$('filter-type').addEventListener('change', renderList);

function renderList() {
    const filterDate = $('filter-date').value;
    const filterType = $('filter-type').value;
    const list = $('attendance-list');
    
    let filtered = attendanceList;
    
    if (filterDate) {
        filtered = filtered.filter(a => a.date === filterDate);
    }
    if (filterType) {
        filtered = filtered.filter(a => a.tipo === filterType);
    }

    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (filtered.length === 0) {
        list.innerHTML = '<p style="text-align:center; padding:20px;">No hay registros</p>';
        return;
    }

    list.innerHTML = filtered.map(att => `
        <div class="attendance-item">
            <div class="item-info">
                <h3>
                    ${att.nombre}
                    <span class="badge badge-${att.tipo}">${att.tipo === 'estudiante' ? 'Estudiante' : 'Visitante'}</span>
                </h3>
                <small>
                    ${att.tipo === 'estudiante' ? `Código: ${att.codigo} | ` : ''}
                    DNI: ${att.dni} | 
                    ${formatDate(att.timestamp)}
                </small>
                ${att.correo ? `<br><small> ${att.correo}</small>` : ''}
                ${att.motivo ? `<br><small> Motivo: ${att.motivo}</small>` : ''}
            </div>
            <button onclick="deleteAttendance('${att.timestamp}')" class="btn btn-danger" style="width:auto; padding:8px 12px;">🗑️</button>
        </div>
    `).join('');
}

function deleteAttendance(timestamp) {
    if (confirm('¿Eliminar este registro?')) {
        attendanceList = attendanceList.filter(a => a.timestamp !== timestamp);
        saveData();
        updateStats();
        renderList();
        showToast('Registro eliminado');
    }
}

// ==================== EXPORTACION ====================
$('export-btn').addEventListener('click', () => {
    if (attendanceList.length === 0) {
        showToast('No hay datos para exportar', 'error');
        return;
    }

    const wb = XLSX.utils.book_new();
    const wsData = attendanceList.map(a => ({
        'Fecha': a.date,
        'Hora': new Date(a.timestamp).toLocaleTimeString('es-ES'),
        'Tipo': a.tipo === 'estudiante' ? 'Estudiante' : 'Visitante',
        'Código': a.codigo || '',
        'Nombre': a.nombre,
        'DNI': a.dni,
        'Correo': a.correo || '',
        'Motivo': a.motivo || ''
    }));

    const ws = XLSX.utils.json_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Asistencias');
    XLSX.writeFile(wb, `asistencias_${getToday()}.xlsx`);
    showToast('Exportado correctamente');
});

// ==================== LIMPIAR DATOS ====================
$('clear-btn').addEventListener('click', () => {
    if (confirm('¿Borrar TODOS los registros de asistencia?')) {
        attendanceList = [];
        saveData();
        updateStats();
        renderList();
        showToast('Todos los registros eliminados');
    }
});

// ==================== PWA ====================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => {
        console.log('Service Worker registrado');
    }).catch(err => console.log('SW Error:', err));
}

// ==================== INICIAR APP ====================
init();