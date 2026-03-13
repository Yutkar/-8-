// --- УНИКАЛЬНЫЕ КЛЮЧИ ДЛЯ GITHUB PAGES ---
const DB_KEY = 'fleet_app_db_v1';
const USER_KEY = 'fleet_app_user_v1'; // Теперь этот ключ будет жить в sessionStorage

// --- БАЗА ДАННЫХ ПО УМОЛЧАНИЮ ---
const defaultDB = {
    users: {
        'admin': { pass: '123', role: 'logistic', name: 'Логист' },
        'courier': { pass: '123', role: 'courier', name: 'Мария К.' },
        'ivan': { pass: '123', role: 'courier', name: 'Иван П.' }
    },
    couriers: [
        { id: 1, name: 'Иван П.', transport: 'Авто', status: 'Свободен', lat: 54.875, lng: 69.160 },
        { id: 2, name: 'Мария К.', transport: 'Мото', status: 'Свободен', lat: 54.860, lng: 69.140 }
    ],
    orders: [
        { id: 101, address: 'ул. Абая, 25', weight: 15, status: 'Ожидает назначения', lat: 54.870, lng: 69.155 }
    ],
    nextOrderId: 102
};

// --- ИНИЦИАЛИЗАЦИЯ ДАННЫХ ---
let db;
try {
    db = JSON.parse(localStorage.getItem(DB_KEY)) || defaultDB;
    if (!db.couriers || !db.orders) db = defaultDB; 
} catch (e) {
    db = defaultDB;
}

// ИСПРАВЛЕНИЕ: Читаем пользователя из sessionStorage (индивидуально для каждой вкладки)
let currentUser = JSON.parse(sessionStorage.getItem(USER_KEY)) || null;

function saveDB() {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
}

let map, mapMarkers = []; 
let courierMap; 
let selectedCoords = null; 
let searchTimeout = null;

// --- 1. АВТО-ВХОД ПРИ ОБНОВЛЕНИИ СТРАНИЦЫ ---
document.addEventListener("DOMContentLoaded", () => {
    if (currentUser) {
        document.getElementById('auth-screen').classList.remove('active');
        
        if (currentUser.role === 'logistic') {
            document.getElementById('logistic-panel').classList.add('active');
            if (typeof L !== 'undefined') { 
                initMap(); 
                updateLogisticViews(); 
                checkBrokenCouriersOnLoad(); 
            }
        } else if (currentUser.role === 'courier') {
            document.getElementById('courier-panel').classList.add('active');
            updateCourierView();
        }
    }
});

// --- СИНХРОНИЗАЦИЯ БАЗЫ ДАННЫХ МЕЖДУ ВКЛАДКАМИ ---
window.addEventListener('storage', (e) => {
    if (e.key === DB_KEY) {
        const oldDB = db;
        db = JSON.parse(e.newValue);
        
        if (currentUser && currentUser.role === 'logistic') {
            db.couriers.forEach(c => {
                const oldC = oldDB.couriers.find(oc => oc.id === c.id);
                if (oldC && oldC.status !== 'Поломка' && c.status === 'Поломка') {
                    showToast(`🚨 ВНИМАНИЕ! Курьер ${c.name} сообщил о поломке!`);
                }
            });
            updateLogisticViews();
            drawMarkers();
        }
        
        if (currentUser && currentUser.role === 'courier') {
            updateCourierView();
        }
    }
});

function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return; 
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 7000);
}

function checkBrokenCouriersOnLoad() {
    const broken = db.couriers.filter(c => c.status === 'Поломка');
    if (broken.length > 0) {
        broken.forEach(c => showToast(`🚨 Напоминание: Курьер ${c.name} находится в статусе ПОЛОМКА!`));
    }
}

// --- 2. АВТОРИЗАЦИЯ И ВЫХОД ---
function handleLogin() {
    const log = document.getElementById('login-input').value.trim().toLowerCase();
    const psw = document.getElementById('password-input').value.trim();
    const err = document.getElementById('auth-error');

    err.style.display = 'none';
    const user = db.users[log];

    if (user && user.pass === psw) {
        currentUser = { login: log, role: user.role, name: user.name };
        
        // ИСПРАВЛЕНИЕ: Сохраняем пользователя только в этой вкладке
        sessionStorage.setItem(USER_KEY, JSON.stringify(currentUser));

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        
        if (user.role === 'logistic') {
            document.getElementById('logistic-panel').classList.add('active');
            if (typeof L !== 'undefined') { 
                initMap(); 
                updateLogisticViews(); 
                checkBrokenCouriersOnLoad();
            } 
        } else if (user.role === 'courier') {
            document.getElementById('courier-panel').classList.add('active');
            updateCourierView();
        }
    } else {
        err.style.display = 'block';
    }
}

function logout() {
    currentUser = null;
    sessionStorage.removeItem(USER_KEY); // Очищаем сессию этой вкладки
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('login-input').value = '';
    document.getElementById('password-input').value = '';
    if (courierMap) closeCourierRoute();
}

function resetApp() {
    localStorage.removeItem(DB_KEY);
    sessionStorage.removeItem(USER_KEY);
    location.reload();
}

function changeLogTab(tabName, btn) {
    document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tabName).classList.add('active');
    btn.classList.add('active');

    if(tabName === 'dashboard' && map) {
        setTimeout(() => map.invalidateSize(), 100);
        drawMarkers();
    }
}

// --- 3. КАРТА ЛОГИСТА ---
function initMap() {
    if (map) { setTimeout(() => map.invalidateSize(), 100); return; }
    map = L.map('map').setView([54.87, 69.15], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    drawMarkers();
}

function drawMarkers() {
    if (!map) return;
    mapMarkers.forEach(m => map.removeLayer(m));
    mapMarkers = [];

    db.couriers.forEach(c => {
        const color = c.status === 'Свободен' ? '#22c55e' : (c.status === 'Поломка' ? '#ef4444' : '#f59e0b');
        const marker = L.circleMarker([c.lat, c.lng], { color: color, radius: 10, fillOpacity: 0.8 }).addTo(map);
        marker.bindPopup(`<b>Курьер: ${c.name}</b><br>Транспорт: ${c.transport}<br>Статус: ${c.status}`);
        mapMarkers.push(marker);
    });

    db.orders.forEach(o => {
        if(o.status === 'Ожидает назначения') {
            const bounds = [[o.lat-0.0005, o.lng-0.0005], [o.lat+0.0005, o.lng+0.0005]];
            const marker = L.rectangle(bounds, {color: '#3b82f6', weight: 1, fillOpacity: 0.8}).addTo(map);
            marker.bindPopup(`<b>Заказ #${o.id}</b><br>${o.address}<br>Вес: ${o.weight} кг`);
            mapMarkers.push(marker);
        }
    });
}

// --- ПОИСК АДРЕСОВ ---
function searchAddress(query) {
    clearTimeout(searchTimeout);
    const suggBox = document.getElementById('address-suggestions');
    selectedCoords = null; 

    if (query.length < 3) { suggBox.style.display = 'none'; return; }

    searchTimeout = setTimeout(() => {
        fetch(`https://nominatim.openstreetmap.org/search?format=json&q=Петропавловск, ${query}&limit=5`)
            .then(res => res.json())
            .then(data => {
                suggBox.innerHTML = '';
                if (data.length > 0) {
                    data.forEach(item => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.innerText = item.display_name.split(', Петропавловск')[0]; 
                        div.onclick = () => {
                            document.getElementById('new-order-address').value = div.innerText;
                            selectedCoords = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
                            suggBox.style.display = 'none';
                        };
                        suggBox.appendChild(div);
                    });
                    suggBox.style.display = 'block';
                } else {
                    suggBox.style.display = 'none';
                }
            });
    }, 600);
}

// --- 4. ФУНКЦИОНАЛ ЛОГИСТА ---
function addOrder() {
    const addr = document.getElementById('new-order-address').value;
    const w = document.getElementById('new-order-weight').value;
    if(!addr || !w || !selectedCoords) return alert("Заполните форму и выберите адрес из подсказки!");

    if (!db.nextOrderId) db.nextOrderId = 105;

    db.orders.unshift({ id: db.nextOrderId++, address: addr, weight: w, status: 'Ожидает назначения', lat: selectedCoords.lat, lng: selectedCoords.lng });
    
    document.getElementById('new-order-address').value = '';
    document.getElementById('new-order-weight').value = '';
    selectedCoords = null;
    
    saveDB(); 
    updateLogisticViews();
    drawMarkers();
}

function addCourier() {
    const name = document.getElementById('new-courier-name').value;
    const trans = document.getElementById('new-courier-transport').value;
    if(!name) return alert("Введите ФИО курьера!");

    const rLat = 54.87 + (Math.random() - 0.5) * 0.05;
    const rLng = 69.15 + (Math.random() - 0.5) * 0.05;

    db.couriers.unshift({ id: Date.now(), name: name, transport: trans, status: 'Свободен', lat: rLat, lng: rLng });
    
    document.getElementById('new-courier-name').value = '';
    saveDB();
    updateLogisticViews();
    drawMarkers();
}

function assignOrder(orderId) {
    const select = document.getElementById(`assign-select-${orderId}`);
    const courierId = parseInt(select.value);
    
    if(!courierId) return alert("Выберите курьера из списка!");

    const order = db.orders.find(o => o.id === orderId);
    const courier = db.couriers.find(c => c.id === courierId);

    order.status = `Назначен: ${courier.name}`;
    courier.status = 'В пути';

    saveDB(); 
    updateLogisticViews();
    drawMarkers();
}

function updateLogisticViews() {
    const availableCouriers = db.couriers.filter(c => c.status !== 'Поломка');
    const optionsHtml = availableCouriers.map(c => `<option value="${c.id}">${c.name} (${c.status})</option>`).join('');

    document.getElementById('orders-list-container').innerHTML = db.orders.map(o => `
        <div class="data-card">
            <h4>Заказ #${o.id}</h4>
            <p>📍 ${o.address}</p>
            <p>⚖️ Вес: ${o.weight} кг</p>
            <p style="margin-top:5px; font-weight:bold; color: ${o.status === 'Ожидает назначения' ? '#3b82f6' : '#22c55e'}">${o.status}</p>
            
            ${o.status === 'Ожидает назначения' ? `
                <div class="assign-block">
                    <select id="assign-select-${o.id}">
                        <option value="">Выберите курьера...</option>
                        ${optionsHtml}
                    </select>
                    <button class="btn-assign" onclick="assignOrder(${o.id})">Назначить</button>
                </div>
            ` : ''}
        </div>
    `).join('');

    document.getElementById('couriers-list-container').innerHTML = db.couriers.map(c => `
        <div class="data-card" style="border-left-color: ${c.status === 'Свободен' ? '#22c55e' : (c.status === 'Поломка' ? '#ef4444' : '#f59e0b')}">
            <h4>${c.name} (${c.transport})</h4>
            <p>Статус: <b style="color: ${c.status === 'Свободен' ? '#22c55e' : (c.status === 'Поломка' ? '#ef4444' : '#f59e0b')}">${c.status}</b></p>
        </div>
    `).join('');
}

// --- 5. ФУНКЦИОНАЛ КУРЬЕРА ---
function updateCourierView() {
    if(!currentUser) return;
    
    const myOrders = db.orders.filter(o => o.status === `Назначен: ${currentUser.name}`);
    
    const me = db.couriers.find(c => c.name === currentUser.name);
    const statusEl = document.getElementById('m-status-text');
    if(me) {
        statusEl.innerText = me.status;
        statusEl.style.color = me.status === 'Поломка' ? '#ef4444' : 'black';
        document.getElementById('btn-breakdown').innerText = me.status === 'Поломка' ? 'Починил' : 'Поломка';
    }

    document.getElementById('courier-orders-list').innerHTML = myOrders.map(o => `
        <div class="data-card" style="border-left-color: #f59e0b">
            <h4>Заказ #${o.id}</h4>
            <p>📍 ${o.address}</p>
            <p>⚖️ Вес: ${o.weight} кг</p>
            <button class="btn-main" style="margin-top:15px; background: #0f172a" onclick="openCourierRoute(${o.id})">🗺 Открыть маршрут</button>
        </div>
    `).join('') || "<p style='color:#64748b; margin-top: 20px;'>У вас нет активных заказов.</p>";
}

function openCourierRoute(orderId) {
    document.getElementById('courier-main-view').style.display = 'none';
    document.getElementById('courier-footer').style.display = 'none';
    document.getElementById('courier-route-view').style.display = 'flex';

    const order = db.orders.find(o => o.id === orderId);
    const courier = db.couriers.find(c => c.name === currentUser.name);

    document.getElementById('courier-route-details').innerHTML = `
        <h3 style="margin-bottom: 5px;">Заказ #${order.id}</h3>
        <p style="margin-bottom: 15px;">📍 ${order.address}</p>
        <button class="btn-main" style="background: #22c55e; margin-bottom: 10px;" onclick="completeOrder(${order.id})">✅ Доставлено</button>
    `;

    setTimeout(() => {
        if (!courierMap) {
            courierMap = L.map('courier-map').setView([courier.lat, courier.lng], 14);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(courierMap);
        } else {
            courierMap.invalidateSize();
        }

        courierMap.eachLayer(layer => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.CircleMarker || layer instanceof L.Rectangle) {
                courierMap.removeLayer(layer);
            }
        });

        L.circleMarker([courier.lat, courier.lng], { color: '#3b82f6', radius: 8, fillOpacity: 1 }).addTo(courierMap).bindPopup("Вы здесь").openPopup();
        L.rectangle([[order.lat-0.0005, order.lng-0.0005], [order.lat+0.0005, order.lng+0.0005]], {color: '#ef4444', weight: 1, fillOpacity: 0.8}).addTo(courierMap).bindPopup("Точка доставки");

        const latlngs = [ [courier.lat, courier.lng], [order.lat, order.lng] ];
        const routeLine = L.polyline(latlngs, {color: '#3b82f6', weight: 4, dashArray: '10, 10'}).addTo(courierMap);
        courierMap.fitBounds(routeLine.getBounds(), {padding: [30, 30]});
    }, 100);
}

function closeCourierRoute() {
    document.getElementById('courier-main-view').style.display = 'block';
    document.getElementById('courier-footer').style.display = 'block';
    document.getElementById('courier-route-view').style.display = 'none';
}

function completeOrder(orderId) {
    const orderIndex = db.orders.findIndex(o => o.id === orderId);
    const courier = db.couriers.find(c => c.name === currentUser.name);

    if(orderIndex > -1 && courier) {
        const order = db.orders[orderIndex];

        courier.lat = order.lat;
        courier.lng = order.lng;

        db.orders.splice(orderIndex, 1); 

        const myRemainingOrders = db.orders.filter(o => o.status === `Назначен: ${currentUser.name}`);
        if(myRemainingOrders.length === 0) {
            courier.status = 'Свободен';
        }
        
        saveDB(); 
        closeCourierRoute();
        updateCourierView();
        
        alert('Посылка успешно доставлена! Ваша геопозиция обновлена на карте.');
    }
}

function toggleCourierStatus() {
    const courier = db.couriers.find(c => c.name === currentUser.name);
    
    if(courier.status !== 'Поломка') {
        courier.status = 'Поломка';
    } else {
        const myRemainingOrders = db.orders.filter(o => o.status === `Назначен: ${currentUser.name}`);
        courier.status = myRemainingOrders.length > 0 ? 'В пути' : 'Свободен';
    }
    
    saveDB(); 
    updateCourierView();
}