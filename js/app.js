// --- БАЗА ДАННЫХ В ПАМЯТИ ---
let nextOrderId = 103; // Счетчик номеров заказов

const db = {
    users: {
        'admin': { pass: '123', role: 'logistic' },
        'courier': { pass: '123', role: 'courier', name: 'Мария К.', id: 2 }
    },
    couriers: [
        { id: 1, name: 'Иван П.', transport: 'Авто', status: 'Свободен', lat: 54.875, lng: 69.160 },
        { id: 2, name: 'Мария К.', transport: 'Мото', status: 'В пути', lat: 54.860, lng: 69.140 }
    ],
    orders: [
        { id: 101, address: 'ул. Абая, 25', weight: 15, status: 'Ожидает назначения', lat: 54.870, lng: 69.155 },
        { id: 102, address: 'ул. Назарбаева, 12', weight: 5, status: 'Назначен: Мария К.', lat: 54.865, lng: 69.135 }
    ]
};

// Переменные для карт и поиска
let map, mapMarkers = []; 
let courierMap; 
let selectedCoords = null; 
let searchTimeout = null;

// --- 1. АВТОРИЗАЦИЯ И НАВИГАЦИЯ ---
function handleLogin() {
    try {
        const log = document.getElementById('login-input').value.trim().toLowerCase();
        const psw = document.getElementById('password-input').value.trim();
        const err = document.getElementById('auth-error');

        err.style.display = 'none';
        const user = db.users[log];

        if (user && user.pass === psw) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            
            if (user.role === 'logistic') {
                document.getElementById('logistic-panel').classList.add('active');
                if (typeof L !== 'undefined') { 
                    initMap(); 
                    updateLogisticViews(); 
                } else { 
                    alert("Карта не загрузилась. Проверьте подключение к интернету!"); 
                }
            } else if (user.role === 'courier') {
                document.getElementById('courier-panel').classList.add('active');
                updateCourierView();
            }
        } else {
            err.style.display = 'block';
        }
    } catch (error) {
        console.error("Ошибка при входе: ", error);
        alert("Произошла техническая ошибка.");
    }
}

function logout() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('login-input').value = '';
    document.getElementById('password-input').value = '';
    
    // Возвращаем курьера на список, если он вышел с экрана карты
    closeCourierRoute();
}

function changeLogTab(tabName, btn) {
    document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tabName).classList.add('active');
    btn.classList.add('active');

    // Перерисовываем карту логиста
    if(tabName === 'dashboard' && map) {
        setTimeout(() => map.invalidateSize(), 100);
        drawMarkers();
    }
}

// --- 2. КАРТА ЛОГИСТА ---
function initMap() {
    if (map) { setTimeout(() => map.invalidateSize(), 100); return; }
    map = L.map('map').setView([54.87, 69.15], 13); // Петропавловск
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    drawMarkers();
}

function drawMarkers() {
    if (!map) return;
    mapMarkers.forEach(m => map.removeLayer(m));
    mapMarkers = [];

    // Курьеры (круглые маркеры)
    db.couriers.forEach(c => {
        const color = c.status === 'Свободен' ? '#22c55e' : (c.status === 'Поломка' ? '#ef4444' : '#f59e0b');
        const marker = L.circleMarker([c.lat, c.lng], { color: color, radius: 10, fillOpacity: 0.8 }).addTo(map);
        marker.bindPopup(`<b>Курьер: ${c.name}</b><br>Транспорт: ${c.transport}<br>Статус: ${c.status}`);
        mapMarkers.push(marker);
    });

    // Заказы (синие квадраты)
    db.orders.forEach(o => {
        if(o.status === 'Ожидает назначения') {
            const bounds = [[o.lat-0.0005, o.lng-0.0005], [o.lat+0.0005, o.lng+0.0005]];
            const marker = L.rectangle(bounds, {color: '#3b82f6', weight: 1, fillOpacity: 0.8}).addTo(map);
            marker.bindPopup(`<b>Заказ #${o.id}</b><br>${o.address}<br>Вес: ${o.weight} кг`);
            mapMarkers.push(marker);
        }
    });
}

// --- 3. ПОИСК АДРЕСОВ ДЛЯ ЗАКАЗОВ ---
function searchAddress(query) {
    clearTimeout(searchTimeout);
    const suggBox = document.getElementById('address-suggestions');
    selectedCoords = null; 

    if (query.length < 3) { suggBox.style.display = 'none'; return; }

    searchTimeout = setTimeout(() => {
        // Поиск с приоритетом в Петропавловске
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
    
    if(!addr || !w) return alert("Заполните адрес и вес!");
    if(!selectedCoords) return alert("Выберите адрес из выпадающего списка, чтобы система нашла его на карте!");

    // Создаем заказ
    db.orders.unshift({ 
        id: nextOrderId++, 
        address: addr, 
        weight: w, 
        status: 'Ожидает назначения', 
        lat: selectedCoords.lat, 
        lng: selectedCoords.lng 
    });
    
    document.getElementById('new-order-address').value = '';
    document.getElementById('new-order-weight').value = '';
    selectedCoords = null;
    
    updateLogisticViews();
    drawMarkers();
    alert("Заказ успешно создан!");
}

function addCourier() {
    const name = document.getElementById('new-courier-name').value;
    const trans = document.getElementById('new-courier-transport').value;
    if(!name) return alert("Введите ФИО курьера!");

    // Появляется недалеко от центра Петропавловска
    const rLat = 54.87 + (Math.random() - 0.5) * 0.05;
    const rLng = 69.15 + (Math.random() - 0.5) * 0.05;

    db.couriers.unshift({ id: Date.now(), name: name, transport: trans, status: 'Свободен', lat: rLat, lng: rLng });
    
    document.getElementById('new-courier-name').value = '';
    updateLogisticViews();
    drawMarkers();
    alert("Курьер добавлен в систему!");
}

function assignOrder(orderId) {
    const select = document.getElementById(`assign-select-${orderId}`);
    const courierId = parseInt(select.value);
    
    if(!courierId) return alert("Выберите курьера из списка!");

    const order = db.orders.find(o => o.id === orderId);
    const courier = db.couriers.find(c => c.id === courierId);

    order.status = `Назначен: ${courier.name}`;
    courier.status = 'В пути';

    updateLogisticViews();
    drawMarkers();
    alert(`Заказ #${orderId} назначен на курьера ${courier.name}!`);
}

function updateLogisticViews() {
    // Получаем свободных курьеров для списков назначения
    const freeCouriers = db.couriers.filter(c => c.status === 'Свободен');
    const optionsHtml = freeCouriers.map(c => `<option value="${c.id}">${c.name} (${c.transport})</option>`).join('');

    // Рендер заказов
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

    // Рендер курьеров
    document.getElementById('couriers-list-container').innerHTML = db.couriers.map(c => `
        <div class="data-card" style="border-left-color: ${c.status === 'Свободен' ? '#22c55e' : (c.status === 'Поломка' ? '#ef4444' : '#f59e0b')}">
            <h4>${c.name} (${c.transport})</h4>
            <p>Статус: <b style="color: ${c.status === 'Свободен' ? '#22c55e' : (c.status === 'Поломка' ? '#ef4444' : '#f59e0b')}">${c.status}</b></p>
        </div>
    `).join('');
}

// --- 5. ФУНКЦИОНАЛ КУРЬЕРА ---
function updateCourierView() {
    const myOrders = db.orders.filter(o => o.status.includes('Мария К.'));
    document.getElementById('courier-orders-list').innerHTML = myOrders.map(o => `
        <div class="data-card" style="border-left-color: #f59e0b">
            <h4>Заказ #${o.id}</h4>
            <p>📍 ${o.address}</p>
            <p>⚖️ Вес: ${o.weight} кг</p>
            <button class="btn-main" style="margin-top:15px; background: #0f172a" onclick="openCourierRoute(${o.id})">🗺 Открыть маршрут</button>
        </div>
    `).join('') || "<p style='color:#64748b'>У вас нет активных заказов.</p>";
}

function openCourierRoute(orderId) {
    document.getElementById('courier-main-view').style.display = 'none';
    document.getElementById('courier-footer').style.display = 'none';
    document.getElementById('courier-route-view').style.display = 'flex';

    const order = db.orders.find(o => o.id === orderId);
    const courier = db.couriers.find(c => c.name === 'Мария К.');

    document.getElementById('courier-route-details').innerHTML = `
        <h3 style="margin-bottom: 5px;">Заказ #${order.id}</h3>
        <p style="margin-bottom: 15px;">📍 ${order.address}</p>
        <button class="btn-main" style="background: #22c55e; margin-bottom: 10px;" onclick="completeOrder(${order.id})">✅ Доставлено</button>
        <button class="m-btn-alert" style="width: 100%; padding: 14px;" onclick="toggleCourierStatus()">⚠️ Сообщить о проблеме</button>
    `;

    // Инициализация карты маршрута курьера
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

        // Маркер курьера
        L.circleMarker([courier.lat, courier.lng], { color: '#3b82f6', radius: 8, fillOpacity: 1 }).addTo(courierMap).bindPopup("Вы здесь").openPopup();
        
        // Маркер заказа
        L.rectangle([[order.lat-0.0005, order.lng-0.0005], [order.lat+0.0005, order.lng+0.0005]], {color: '#ef4444', weight: 1, fillOpacity: 0.8}).addTo(courierMap).bindPopup("Точка доставки");

        // Линия маршрута
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
    if(orderIndex > -1) db.orders.splice(orderIndex, 1); 

    const courier = db.couriers.find(c => c.name === 'Мария К.');
    courier.status = 'Свободен';
    
    alert('Супер! Заказ доставлен, статус изменен на "Свободен".');
    closeCourierRoute();
    updateCourierView();
}

function toggleCourierStatus() {
    const el = document.getElementById('m-status-text');
    if(el.innerText === 'Онлайн') {
        el.innerText = 'ПОЛОМКА';
        el.style.color = '#ef4444';
        db.couriers.find(c => c.name === 'Мария К.').status = 'Поломка';
        alert('Диспетчер уведомлен о поломке!');
    } else {
        el.innerText = 'Онлайн';
        el.style.color = 'black';
        db.couriers.find(c => c.name === 'Мария К.').status = 'Свободен';
    }
}