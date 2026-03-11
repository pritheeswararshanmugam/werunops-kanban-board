/**
 * Application Logic for BackOffice Pro
 */

// Global State refs
let charts = {};
let sortableInstances = [];
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    setupAuth();

    // 1. Initialize UI Elements
    initNavigation();
    initModals();
    setupProfileModal();
    setupSettingsModal();
    setupHeaderFeatures();
    initFilters();

    // Show Loading
    document.getElementById('global-loader').classList.remove('hidden');

    // 2. Initialize Data Store
    await store.init();

    // Subscribe to state changes to update UI
    store.subscribe((state) => {
        renderAllViews(state);
    });

    // Initial Render
    renderAllViews(store.state);

    // Hide Loading
    document.getElementById('global-loader').classList.add('hidden');

    // 3. Setup form handlers
    setupFormHandlers();

    // 4. Show a welcome notification
    showNotification('Success', 'Connected to data source successfully.', 'success');
});

// --- View Rendering Engine ---

function renderAllViews(state) {
    if (!state) return;

    renderDashboard(state);
    renderKanban(state);
    renderAllTasksList(state);
    renderTodayTasks(state);
    renderClientsList(state);
    populateSelects(state.config);
}

// --- Navigation & Routing ---

function initNavigation() {
    const navTabs = document.querySelectorAll('.nav-tab');
    const views = document.querySelectorAll('.view-section');

    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active styling on tabs
            navTabs.forEach(t => {
                t.classList.remove('active', 'text-primary');
                t.classList.add('text-gray-500');
                t.style.borderBottomColor = 'transparent';
            });

            tab.classList.add('active', 'text-primary');
            tab.classList.remove('text-gray-500');
            tab.style.borderBottomColor = 'var(--primary-blue)';

            // Show target view, hide others
            const targetId = tab.getAttribute('data-target');
            views.forEach(view => {
                if (view.id === targetId) {
                    view.classList.remove('hidden');
                    // If switching to dashboard, resize charts to fix Chart.js canvas render issues
                    if (targetId === 'view-dashboard') {
                        Object.values(charts).forEach(chart => chart.resize());
                    }
                } else {
                    view.classList.add('hidden');
                }
            });

            // Mobile menu behavior
            if (window.innerWidth < 768) {
                document.getElementById('main-nav').classList.add('hidden');
            }
        });
    });

    // Mobile Menu Toggle
    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
        const nav = document.getElementById('main-nav');
        nav.classList.toggle('hidden');
        if (!nav.classList.contains('hidden')) {
            nav.classList.add('flex', 'flex-col', 'absolute', 'top-16', 'left-0', 'w-full', 'bg-white', 'shadow-md', 'z-40');
        } else {
            nav.classList.remove('flex', 'flex-col', 'absolute', 'top-16', 'left-0', 'w-full', 'bg-white', 'shadow-md', 'z-40');
        }
    });
}

// --- UI Utilities ---

function getStatusColorClass(status) {
    const map = {
        'New': 'status-badge-new',
        'In Progress': 'status-badge-progress',
        'Waiting Client': 'status-badge-waitingClient',
        'Waiting Supplier': 'status-badge-waitingSupplier',
        'Follow Up': 'status-badge-followup',
        'Completed': 'status-badge-completed'
    };
    return map[status] || 'bg-gray-100 text-gray-800';
}

function getStatusIcon(status) {
    const map = {
        'New': 'sparkles',
        'In Progress': 'settings-2',
        'Waiting Client': 'users',
        'Waiting Supplier': 'package',
        'Follow Up': 'phone-call',
        'Completed': 'check-circle'
    };
    return map[status] || 'circle';
}

function getPriorityColor(priority) {
    const map = {
        'High': 'var(--priority-high)',
        'Medium': 'var(--priority-medium)',
        'Low': 'var(--priority-low)'
    };
    return map[priority] || 'gray';
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isToday(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

function isOverdue(dateString) {
    if (!dateString) return false;
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today
    return date < today;
}

function showNotification(title, message, type = 'info') {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');

    let icon = 'info';
    let colorClass = 'bg-blue-50 text-blue-800 border-blue-200';
    let iconClass = 'text-blue-500';

    if (type === 'success') {
        icon = 'check-circle';
        colorClass = 'bg-green-50 text-green-800 border-green-200';
        iconClass = 'text-green-500';
    } else if (type === 'error') {
        icon = 'alert-circle';
        colorClass = 'bg-red-50 text-red-800 border-red-200';
        iconClass = 'text-red-500';
    } else if (type === 'warning') {
        icon = 'alert-triangle';
        colorClass = 'bg-amber-50 text-amber-800 border-amber-200';
        iconClass = 'text-amber-500';
    }

    toast.className = `flex items-start p-4 mb-2 border rounded-lg shadow-lg pointer-events-auto toast-enter ${colorClass} w-80`;
    toast.innerHTML = `
        <div class="inline-flex items-center justify-center flex-shrink-0 w-6 h-6 mr-3">
            <i data-lucide="${icon}" class="w-5 h-5 ${iconClass}"></i>
        </div>
        <div class="flex-1">
            <h4 class="font-semibold text-sm">${title}</h4>
            <div class="text-sm mt-1 opacity-90">${message}</div>
        </div>
        <button class="ml-auto -mx-1.5 -my-1.5 p-1.5 rounded-lg focus:ring-2 focus:ring-gray-300 hover:bg-black/5 inline-flex h-8 w-8 justify-center items-center transition" aria-label="Close" onclick="this.parentElement.remove()">
            <i data-lucide="x" class="w-4 h-4"></i>
        </button>
    `;

    container.appendChild(toast);
    lucide.createIcons({ root: toast });

    // Auto remove after 5 secs
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.remove('toast-enter');
            toast.classList.add('toast-leave');
            setTimeout(() => {
                if (toast.parentElement) toast.remove();
            }, 300);
        }
    }, 5000);
}

// --- Module 1: Dashboard Rendering ---

function renderDashboard(state) {
    const tasks = state.tasks;

    // 1. Calculate Metrics
    let openCount = 0, inProgressCount = 0, completedCount = 0, overdueCount = 0;

    tasks.forEach(t => {
        if (t.status === 'Completed') completedCount++;
        else {
            openCount++;
            if (t.status === 'In Progress') inProgressCount++;
            if (isOverdue(t.dueDate)) overdueCount++;
        }
    });

    const metricsContainer = document.getElementById('dashboard-metrics');
    metricsContainer.innerHTML = `
        ${createMetricCard('Open Tasks', openCount, 'folder-open', 'bg-blue-500')}
        ${createMetricCard('In Progress', inProgressCount, 'settings-2', 'bg-amber-500')}
        ${createMetricCard('Completed', completedCount, 'check-circle', 'bg-gray-500')}
        ${createMetricCard('Overdue', overdueCount, 'alert-circle', overdueCount > 0 ? 'bg-red-500 animate-pulse' : 'bg-red-500')}
    `;
    lucide.createIcons({ root: metricsContainer });

    // 2. Charts
    updateStatusChart(tasks, state.config.statuses);
    updatePriorityChart(tasks, state.config.priorities);
    updateStaffChart(tasks, state.config.staff);
    updateClientChart(tasks);

    // 3. Activity Feed
    renderActivityFeed(tasks);
}

function createMetricCard(title, value, icon, iconBgClass) {
    return `
        <div class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
            <div class="w-12 h-12 rounded-full ${iconBgClass} text-white flex items-center justify-center flex-shrink-0 shadow-inner">
                <i data-lucide="${icon}" class="w-6 h-6"></i>
            </div>
            <div>
                <p class="text-sm font-medium text-gray-500">${title}</p>
                <p class="text-3xl font-bold text-gray-800">${value}</p>
            </div>
        </div>
    `;
}

// Chart Configurations
function getChartColors() {
    const style = getComputedStyle(document.body);
    return {
        new: style.getPropertyValue('--status-new').trim(),
        progress: style.getPropertyValue('--status-progress').trim(),
        waitingClient: style.getPropertyValue('--status-waiting-client').trim(),
        waitingSupplier: style.getPropertyValue('--status-waiting-supplier').trim(),
        followup: style.getPropertyValue('--status-followup').trim(),
        completed: style.getPropertyValue('--status-completed').trim(),
        high: style.getPropertyValue('--priority-high').trim(),
        medium: style.getPropertyValue('--priority-medium').trim(),
        low: style.getPropertyValue('--priority-low').trim(),
    };
}

function updateStatusChart(tasks, statusList) {
    const ctx = document.getElementById('chart-status').getContext('2d');
    const colors = getChartColors();

    const counts = statusList.map(status => tasks.filter(t => t.status === status).length);
    const bgColors = [colors.new, colors.progress, colors.waitingClient, colors.waitingSupplier, colors.followup, colors.completed];

    if (charts.status) charts.status.destroy();

    charts.status = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: statusList,
            datasets: [{
                data: counts,
                backgroundColor: bgColors,
                borderWidth: 2,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { usePointStyle: true, padding: 15, font: { family: 'Inter' } } }
            },
            cutout: '70%'
        }
    });
}

function updatePriorityChart(tasks, priorityList) {
    const ctx = document.getElementById('chart-priority').getContext('2d');
    const colors = getChartColors();

    const counts = priorityList.map(prio => tasks.filter(t => t.priority === prio && t.status !== 'Completed').length);
    const bgColors = [colors.high, colors.medium, colors.low];

    if (charts.priority) charts.priority.destroy();

    charts.priority = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: priorityList,
            datasets: [{
                label: 'Open Tasks',
                data: counts,
                backgroundColor: bgColors,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, grid: { borderDash: [2, 4], color: '#f3f4f6' }, ticks: { stepSize: 1, font: { family: 'Inter' } } },
                x: { grid: { display: false }, ticks: { font: { family: 'Inter' } } }
            }
        }
    });
}

function updateStaffChart(tasks, staffList) {
    const ctx = document.getElementById('chart-staff').getContext('2d');

    // Filter staffList to only show valid users based on our hardcoded list
    const validUsersList = ['Pritheeswarar', 'Mubarak', 'Sudharshan'];
    const filteredStaff = staffList.filter(s => validUsersList.includes(s));

    // Sort staff by workload
    const workloads = filteredStaff.map(staff => ({
        name: staff,
        count: tasks.filter(t => t.staff === staff && t.status !== 'Completed').length
    })).sort((a, b) => b.count - a.count);

    if (charts.staff) charts.staff.destroy();

    charts.staff = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: workloads.map(w => w.name),
            datasets: [{
                label: 'Active Tasks',
                data: workloads.map(w => w.count),
                backgroundColor: '#3b82f6', // primary blue
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, grid: { borderDash: [2, 4] }, ticks: { stepSize: 1 } },
                y: { grid: { display: false } }
            }
        }
    });
}

function updateClientChart(tasks) {
    const ctx = document.getElementById('chart-client').getContext('2d');

    // Get unique clients and count active tasks
    const clientMap = {};
    tasks.forEach(t => {
        if (t.status !== 'Completed') {
            clientMap[t.client] = (clientMap[t.client] || 0) + 1;
        }
    });

    // Sort and get top 5 + others
    const sortedClients = Object.keys(clientMap).map(client => ({
        name: client, count: clientMap[client]
    })).sort((a, b) => b.count - a.count);

    const labels = [];
    const counts = [];
    let otherCount = 0;

    sortedClients.forEach((c, idx) => {
        if (idx < 5) {
            labels.push(c.name);
            counts.push(c.count);
        } else {
            otherCount += c.count;
        }
    });

    if (otherCount > 0) {
        labels.push('Others');
        counts.push(otherCount);
    }

    if (charts.client) charts.client.destroy();

    charts.client = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels.length > 0 ? labels : ['No active tasks'],
            datasets: [{
                data: counts.length > 0 ? counts : [1],
                backgroundColor: counts.length > 0 ?
                    ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#6b7280'] :
                    ['#e5e7eb'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { family: 'Inter' } } }
            }
        }
    });
}

function renderActivityFeed(tasks) {
    const feedContainer = document.getElementById('activity-feed');

    // Extract all activity logs, attach task data
    let allActivities = [];
    tasks.forEach(task => {
        if (task.activityLog) {
            task.activityLog.forEach(log => {
                allActivities.push({
                    ...log,
                    taskId: task.id,
                    taskName: task.task
                });
            });
        }
    });

    // Sort descending by timestamp
    allActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Take top 15
    const recentActivities = allActivities.slice(0, 15);

    if (recentActivities.length === 0) {
        feedContainer.innerHTML = `<p class="text-sm text-gray-500 text-center py-4">No recent activity.</p>`;
        return;
    }

    let html = '<div class="space-y-4 relative">';
    // Add timeline line
    html += '<div class="absolute top-0 bottom-0 left-[19px] w-px bg-gray-200"></div>';

    recentActivities.forEach(act => {
        const timeAgo = getTimeAgo(act.timestamp);
        let icon = 'activity';
        let bg = 'bg-gray-100 text-gray-600';

        if (act.action.includes('created')) { icon = 'plus'; bg = 'bg-blue-100 text-blue-600'; }
        else if (act.action.includes('Status changed') || act.action.includes('via drag')) { icon = 'arrow-right-left'; bg = 'bg-amber-100 text-amber-600'; }
        else if (act.action.toLowerCase().includes('completed')) { icon = 'check'; bg = 'bg-green-100 text-green-600'; }

        html += `
            <div class="flex gap-4 relative z-10">
                <div class="w-10 h-10 rounded-full ${bg} flex items-center justify-center flex-shrink-0 border-4 border-white">
                    <i data-lucide="${icon}" class="w-4 h-4"></i>
                </div>
                <div class="flex-1 pt-2 pb-1">
                    <p class="text-sm text-gray-800"><span class="font-medium">${act.user}</span> ${act.action.toLowerCase()}</p>
                    <p class="text-xs text-primary font-medium mt-0.5 hover:underline cursor-pointer" onclick="openTaskModal(${act.taskId})">#${act.taskId} ${act.taskName}</p>
                    <p class="text-xs text-gray-400 mt-1">${timeAgo}</p>
                </div>
            </div>
        `;
    });
    html += '</div>';

    feedContainer.innerHTML = html;
    lucide.createIcons({ root: feedContainer });
}

function getTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) return interval + " year" + (interval > 1 ? "s" : "") + " ago";
    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval + " month" + (interval > 1 ? "s" : "") + " ago";
    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval + " day" + (interval > 1 ? "s" : "") + " ago";
    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval + " hour" + (interval > 1 ? "s" : "") + " ago";
    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval + " min" + (interval > 1 ? "s" : "") + " ago";
    return "just now";
}

// --- Module 2: Kanban Rendering ---
function renderKanban(state) {
    const board = document.getElementById('kanban-board');
    if (!board) return;

    // Cleanup old sortable instances
    sortableInstances.forEach(instance => instance.destroy());
    sortableInstances = [];

    const statuses = state.config.statuses;
    let html = '';

    // Build columns
    statuses.forEach(status => {
        const columnTasks = state.tasks.filter(t => t.status === status);
        const icon = getStatusIcon(status);
        const colorClass = getStatusColorClass(status);
        const headClass = `kanban-col-head-${status.replace(/\s+/g, '')}`;

        html += `
            <div class="flex flex-col bg-gray-50 rounded-xl w-72 flex-shrink-0 ${headClass} shadow-sm border border-gray-200 max-h-full overflow-hidden pb-1">
                <div class="p-4 flex justify-between items-center border-b border-gray-200 sticky top-0 bg-gray-50 z-10 rounded-t-xl shrink-0">
                    <h3 class="font-bold text-gray-700 flex items-center gap-2">
                        <div class="w-6 h-6 rounded-md ${colorClass} flex items-center justify-center">
                            <i data-lucide="${icon}" class="w-3.5 h-3.5"></i>
                        </div>
                        ${status}
                    </h3>
                    <span class="bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full text-xs font-semibold">${columnTasks.length}</span>
                </div>
                
                <div class="p-3 flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-3 min-h-[50px] sortable-col" data-status="${status}">
                    ${columnTasks.map(task => createKanbanCard(task)).join('')}
                </div>
            </div>
        `;
    });

    board.innerHTML = html;
    lucide.createIcons({ root: board });

    // Initialize Drag & Drop
    const cols = document.querySelectorAll('.sortable-col');
    cols.forEach(col => {
        const instance = new Sortable(col, {
            group: 'kanban', // set both lists to same group
            animation: 150,
            ghostClass: 'sortable-ghost',
            delay: window.innerWidth < 768 ? 200 : 0, // delay on mobile to allow scrolling
            delayOnTouchOnly: true,
            onEnd: function (evt) {
                const itemEl = evt.item;  // dragged HTMLElement
                const toCol = evt.to;    // target list

                const newStatus = toCol.getAttribute('data-status');
                const taskId = itemEl.getAttribute('data-id');

                if (taskId && newStatus && evt.from !== toCol) {
                    store.updateTaskStatus(taskId, newStatus);
                }
            },
        });
        sortableInstances.push(instance);
    });

}

function createKanbanCard(task) {
    const priorityColor = `border-priority-${task.priority}`;
    return `
        <div class="bg-white p-3 rounded-lg shadow-sm hover:shadow-md cursor-grab active:cursor-grabbing border items-center border-l-4 border-y-gray-200 border-r-gray-200 ${priorityColor} transition group relative" data-id="${task.id}" onclick="openTaskModal(${task.id})">
            
            <!-- Quick actions on hover -->
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition flex gap-1 bg-white rounded-md shadow-sm border border-gray-100 p-0.5 z-10">
                <button class="p-1 text-gray-400 hover:text-primary rounded" onclick="event.stopPropagation(); openTaskModal(${task.id})"><i data-lucide="edit-2" class="w-3.5 h-3.5"></i></button>
            </div>

            <div class="flex justify-between items-start mb-1.5 pr-6">
                <span class="text-xs font-semibold text-gray-500">#${task.id} &bull; ${task.client}</span>
            </div>
            
            <h4 class="text-sm font-semibold text-gray-800 leading-tight mb-1">${task.task}</h4>
            ${task.project ? `<p class="text-xs text-gray-500 mb-2 truncate"><i data-lucide="home" class="w-3 h-3 inline mr-1 pb-0.5"></i>${task.project}</p>` : ''}
            
            ${task.notes ? `<p class="text-xs text-gray-500 mb-3 line-clamp-2 italic border-l-2 pl-2">"${task.notes}"</p>` : '<div class="mb-3"></div>'}
            
            <div class="flex items-center justify-between mt-auto">
                <div class="flex items-center gap-1.5">
                    <div class="w-6 h-6 rounded-full bg-primary-light text-primary flex items-center justify-center text-xs font-bold" title="${task.staff}">
                        ${task.staff.charAt(0)}
                    </div>
                </div>
                
                <div class="flex gap-2 text-xs">
                    ${task.waitingFor ? `<span class="text-red-500 font-medium" title="Waiting for: ${task.waitingFor}"><i data-lucide="clock" class="w-3.5 h-3.5 inline"></i></span>` : ''}
                    <span class="${isOverdue(task.dueDate) ? 'text-red-600 font-bold bg-red-100 px-1.5 rounded' : 'text-gray-500'}">
                        ${formatDate(task.dueDate).replace(/, 202./, '')}
                    </span>
                </div>
            </div>
        </div>
    `;
}

// --- Module 3: All Tasks List ---
let currentSort = { column: 'id', dir: 'asc' };
let currentSearch = '';

function renderAllTasksList(state) {
    const tbody = document.getElementById('tasks-table-body');
    if (!tbody) return;

    let tasks = [...state.tasks];

    // Search filter
    if (currentSearch) {
        const lowerSearch = currentSearch.toLowerCase();
        tasks = tasks.filter(t =>
            t.task.toLowerCase().includes(lowerSearch) ||
            t.client.toLowerCase().includes(lowerSearch) ||
            (t.project && t.project.toLowerCase().includes(lowerSearch)) ||
            t.id.toString().includes(lowerSearch) ||
            t.staff.toLowerCase().includes(lowerSearch)
        );
    }

    // Sort
    tasks.sort((a, b) => {
        let valA = a[currentSort.column];
        let valB = b[currentSort.column];

        if (currentSort.column === 'dueDate' || currentSort.column === 'startDate') {
            valA = valA ? new Date(valA).getTime() : 0;
            valB = valB ? new Date(valB).getTime() : 0;
        } else if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (valA < valB) return currentSort.dir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.dir === 'asc' ? 1 : 1;
        return 0;
    });

    document.getElementById('tasks-count-display').textContent = `Showing ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;

    let html = '';
    tasks.forEach(task => {
        html += `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 group">
                <td class="px-4 py-3 whitespace-nowrap">
                    <input type="checkbox" class="task-checkbox rounded border-gray-300 text-primary cursor-pointer w-4 h-4 focus:ring-primary" value="${task.id}">
                </td>
                <td class="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-500">
                    #${task.id}
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <div class="font-medium text-gray-800">${task.client}</div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-gray-600">
                    ${task.project || '-'}
                </td>
                <td class="px-4 py-3 min-w-[200px]">
                    <div class="font-medium text-gray-800 w-full truncate max-w-xs cursor-pointer hover:text-primary hover:underline hover-active" onclick="openTaskModal(${task.id}, {viewOnly: true})">${task.task}</div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <div class="flex items-center gap-2 text-gray-700">
                        <div class="w-6 h-6 rounded-full bg-primary-light text-primary flex items-center justify-center text-xs font-bold">
                            ${task.staff.charAt(0)}
                        </div>
                        ${task.staff}
                    </div>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <span class="status-badge ${getStatusColorClass(task.status)}">
                        <i data-lucide="${getStatusIcon(task.status)}" class="w-3 h-3 mr-1 inline-block"></i> ${task.status}
                    </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <span class="text-xs font-bold px-2 py-1 rounded bg-priority-${task.priority} border border-priority-${task.priority} border-opacity-20 text-priority-${task.priority}">
                        ${task.priority}
                    </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap ${isOverdue(task.dueDate) && task.status !== 'Completed' ? 'text-red-600 font-semibold bg-red-50 rounded px-2' : 'text-gray-600'}">
                    ${formatDate(task.dueDate)}
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                    <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="text-gray-400 hover:text-primary transition p-1" onclick="openTaskModal(${task.id})" title="Edit">
                            <i data-lucide="edit" class="w-4 h-4"></i>
                        </button>
                        <button class="text-gray-400 hover:text-red-500 transition p-1" onclick="deleteSingleTask(${task.id})" title="Delete">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    if (tasks.length === 0) {
        html = `<tr><td colspan="10" class="px-4 py-8 text-center text-gray-500">No tasks found. Try adjusting your search/filters.</td></tr>`;
    }

    tbody.innerHTML = html;
    lucide.createIcons({ root: tbody });

    // Sort logic setup
    document.querySelectorAll('.sort-header').forEach(header => {
        // Clear old listeners
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);

        newHeader.addEventListener('click', () => {
            const col = newHeader.getAttribute('data-sort');
            if (currentSort.column === col) {
                currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = col;
                currentSort.dir = 'asc';
            }

            // Update icons
            document.querySelectorAll('.sort-icon').forEach(icon => icon.classList.add('hidden'));
            const icon = newHeader.querySelector('.sort-icon');
            icon.classList.remove('hidden');
            if (currentSort.dir === 'desc') icon.setAttribute('data-lucide', 'chevron-up');
            else icon.setAttribute('data-lucide', 'chevron-down');
            lucide.createIcons();

            renderAllTasksList(store.state);
        });
    });

    // Checkbox logic
    const selectAll = document.getElementById('selectAllTasks');
    const bulkActionBtn = document.getElementById('btn-bulk-actions');

    // Clear old listener
    const newSelectAll = selectAll.cloneNode(true);
    selectAll.parentNode.replaceChild(newSelectAll, selectAll);

    newSelectAll.addEventListener('change', (e) => {
        document.querySelectorAll('.task-checkbox').forEach(cb => {
            cb.checked = e.target.checked;
            updateRowHighlight(cb);
        });
        updateBulkActionsState();
    });

    // Delegated listener for individual checkboxes
    tbody.removeEventListener('change', handleCheckboxChange);
    tbody.addEventListener('change', handleCheckboxChange);
}

function handleCheckboxChange(e) {
    if (e.target.classList.contains('task-checkbox')) {
        updateRowHighlight(e.target);
        updateBulkActionsState();

        // update selectAll state
        const allChecked = Array.from(document.querySelectorAll('.task-checkbox')).every(c => c.checked);
        const someChecked = Array.from(document.querySelectorAll('.task-checkbox')).some(c => c.checked);
        const selectAll = document.getElementById('selectAllTasks');
        selectAll.checked = allChecked;
        selectAll.indeterminate = someChecked && !allChecked;
    }
}

function updateRowHighlight(checkbox) {
    const row = checkbox.closest('tr');
    if (checkbox.checked) row.classList.add('selected-row');
    else row.classList.remove('selected-row');
}

function updateBulkActionsState() {
    const checkedCount = document.querySelectorAll('.task-checkbox:checked').length;
    const btn = document.getElementById('btn-bulk-actions');
    btn.disabled = checkedCount === 0;
    if (checkedCount === 0) {
        document.getElementById('bulk-actions-menu').classList.add('hidden');
    }
}

// --- Module 5: Client Management ---

function renderClientsList(state) {
    const tbody = document.getElementById('clients-table-body');
    if (!tbody) return;

    let html = '';
    const clients = state.config.clients;

    clients.forEach(client => {
        const activeTasks = state.tasks.filter(t => t.client === client.name && t.status !== 'Completed').length;
        const totalTasks = state.tasks.filter(t => t.client === client.name).length;

        html += `
            <tr class="hover:bg-gray-50 transition border-b border-gray-100 group">
                <td class="px-6 py-4">
                    <div class="font-bold text-gray-800">${client.name}</div>
                    ${client.contact ? `<div class="text-xs text-gray-500 mt-1"><i data-lucide="user" class="w-3 h-3 inline mr-1"></i>${client.contact}</div>` : ''}
                    ${client.email ? `<div class="text-xs text-gray-400 mt-0.5"><i data-lucide="mail" class="w-3 h-3 inline mr-1"></i>${client.email}</div>` : ''}
                    ${client.phone ? `<div class="text-xs text-gray-400 mt-0.5"><i data-lucide="phone" class="w-3 h-3 inline mr-1"></i>${client.phone}</div>` : ''}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="status-badge ${activeTasks > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}">
                        ${activeTasks > 0 ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-700">${activeTasks} <span class="text-gray-400 font-normal">/ ${totalTasks} total</span></div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right">
                    <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="text-gray-400 hover:text-primary transition p-1" onclick="openClientModal('${client.name}')" title="Edit Client">
                            <i data-lucide="edit-2" class="w-4 h-4"></i>
                        </button>
                        <button class="text-gray-400 hover:text-red-500 transition p-1" onclick="deleteClientAction('${client.name}')" title="Delete Client" ${activeTasks > 0 ? 'disabled class="opacity-30 cursor-not-allowed"' : ''}>
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    if (clients.length === 0) {
        html = `<tr><td colspan="4" class="px-6 py-8 text-center text-gray-500">No clients found. Click Add Client to begin.</td></tr>`;
    }

    tbody.innerHTML = html;
    lucide.createIcons({ root: tbody });
}

window.deleteClientAction = async function (clientName) {
    if (confirm(`Are you sure you want to delete the client "${clientName}"? This action cannot be undone.`)) {
        try {
            await store.deleteClient(clientName);
            showNotification('Deleted', `Client "${clientName}" deleted successfully.`, 'success');
        } catch (error) {
            showNotification('Error', error.message, 'error');
        }
    }
}

// --- Module 4: Today's Tasks ---

function renderTodayTasks(state) {
    const todayList = document.getElementById('list-today');
    const overdueList = document.getElementById('list-overdue');
    const followupList = document.getElementById('list-followup');

    let dueToday = [], overdue = [], followUp = [];

    state.tasks.forEach(task => {
        if (task.status === 'Completed') return;

        if (isOverdue(task.dueDate)) {
            overdue.push(task);
        } else if (isToday(task.dueDate)) {
            dueToday.push(task);
        }

        if (task.status === 'Follow Up') {
            followUp.push(task);
        }
    });

    // Sort High to Low Priority
    const priorityWeight = { 'High': 3, 'Medium': 2, 'Low': 1 };
    const sortPrio = (a, b) => priorityWeight[b.priority] - priorityWeight[a.priority];

    dueToday.sort(sortPrio);
    followUp.sort(sortPrio);
    overdue.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)); // Oldest first

    // Update metrics
    document.getElementById('metric-today-due').textContent = dueToday.length;
    document.getElementById('metric-today-overdue').textContent = overdue.length;
    document.getElementById('metric-today-followup').textContent = followUp.length;

    document.getElementById('badge-today').textContent = `${dueToday.length} task${dueToday.length !== 1 ? 's' : ''}`;
    document.getElementById('badge-overdue').textContent = `${overdue.length} task${overdue.length !== 1 ? 's' : ''}`;
    document.getElementById('badge-followup').textContent = `${followUp.length} task${followUp.length !== 1 ? 's' : ''}`;

    document.getElementById('today-date-display').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    todayList.innerHTML = dueToday.length ? dueToday.map(createTodayCard).join('') : emptyState('No tasks due today. Awesome!');
    overdueList.innerHTML = overdue.length ? overdue.map(createTodayCard).join('') : emptyState('All caught up! No overdue tasks.', 'check-circle', 'text-green-500');
    followupList.innerHTML = followUp.length ? followUp.map(createTodayCard).join('') : emptyState('No follow-ups needed today.');

    lucide.createIcons({ root: document.getElementById('view-today') });
}

function emptyState(message, icon = 'smile', colorClass = 'text-gray-400') {
    return `
        <div class="bg-gray-50 border border-gray-200 border-dashed rounded-lg p-6 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
            <i data-lucide="${icon}" class="w-8 h-8 ${colorClass} mb-1"></i>
            <p>${message}</p>
        </div>
    `;
}

function createTodayCard(task) {
    const isOverdueTask = isOverdue(task.dueDate);
    return `
        <div class="bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow border items-center border-l-4 border-y-gray-200 border-r-gray-200 border-priority-${task.priority}">
            <div class="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-mono text-gray-500">#${task.id}</span>
                        <span class="text-xs font-bold px-2 py-0.5 rounded bg-priority-${task.priority} text-priority-${task.priority}">${task.priority}</span>
                        <span class="status-badge ${getStatusColorClass(task.status)}">${task.status}</span>
                    </div>
                    
                    <h4 class="text-lg font-bold text-gray-800 leading-tight mb-1 cursor-pointer hover:text-primary hover:underline" onclick="openTaskModal(${task.id})">${task.task}</h4>
                    <p class="text-sm text-gray-600 font-medium"><i data-lucide="home" class="w-4 h-4 inline mr-1 text-gray-400"></i>${task.client} ${task.project ? `&rsaquo; ${task.project}` : ''}</p>
                    ${task.notes ? `<p class="text-sm text-gray-500 mt-2 line-clamp-1 italic bg-gray-50 p-2 rounded">"${task.notes}"</p>` : ''}
                </div>
                
                <div class="flex flex-row sm:flex-col items-end gap-3 sm:gap-2 justify-between w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t border-gray-100 sm:border-0">
                    <div class="flex gap-4 sm:gap-2">
                        <div class="flex items-center text-sm text-gray-600" title="${task.staff}">
                            <i data-lucide="user" class="w-4 h-4 mr-1 text-gray-400"></i> ${task.staff}
                        </div>
                        <div class="flex items-center text-sm ${isOverdueTask ? 'text-red-600 font-bold' : 'text-gray-600'}">
                            <i data-lucide="calendar" class="w-4 h-4 mr-1 ${isOverdueTask ? 'text-red-500' : 'text-gray-400'}"></i> ${formatDate(task.dueDate)}
                        </div>
                    </div>
                    
                    <div class="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        <button onclick="markAsComplete(${task.id})" class="flex-1 sm:flex-none px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded-md text-sm font-medium transition flex items-center justify-center gap-1">
                            <i data-lucide="check" class="w-4 h-4"></i> Complete
                        </button>
                        <button onclick="openTaskModal(${task.id})" class="flex-1 sm:flex-none px-3 py-1.5 bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-md text-sm font-medium transition flex items-center justify-center gap-1">
                            <i data-lucide="eye" class="w-4 h-4"></i> View
                        </button>
                    </div>
                </div>
                
            </div>
        </div>
    `;
}

// Global action handler
window.markAsComplete = async function (taskId) {
    if (confirm('Mark this task as completed?')) {
        await store.updateTaskStatus(taskId, 'Completed');
        showNotification('Task Completed', `Task #${taskId} has been marked as completed.`, 'success');
    }
}

// --- Forms and Setup ---

function populateSelects(config) {
    const selectors = [
        { id: 'task-client', options: config.clients.map(c => c.name).sort() },
        { id: 'task-staff', options: config.staff },
        { id: 'task-status', options: config.statuses },
    ];

    selectors.forEach(sel => {
        const el = document.getElementById(sel.id);
        if (!el) return;
        el.innerHTML = sel.options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    });
}

function setupFormHandlers() {
    // Search input
    const searchInput = document.getElementById('tasks-search');
    const searchClear = document.getElementById('tasks-search-clear');

    // Header Menus
    const headerSearchBtn = document.getElementById('header-search-btn');
    const headerSearchPanel = document.getElementById('header-search-panel');
    const headerBellBtn = document.getElementById('header-bell-btn');
    const headerNotifPanel = document.getElementById('header-notifications-panel');
    const headerUserBtn = document.getElementById('header-user-menu-btn');
    const headerUserPanel = document.getElementById('header-user-panel');

    function closeAllHeaderMenus() {
        headerSearchPanel?.classList.add('hidden');
        headerNotifPanel?.classList.add('hidden');
        headerUserPanel?.classList.add('hidden');
    }

    headerSearchBtn?.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = headerSearchPanel.classList.contains('hidden'); closeAllHeaderMenus(); if (isHidden) headerSearchPanel.classList.remove('hidden'); });
    headerBellBtn?.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = headerNotifPanel.classList.contains('hidden'); closeAllHeaderMenus(); if (isHidden) headerNotifPanel.classList.remove('hidden'); });
    headerUserBtn?.addEventListener('click', (e) => { e.stopPropagation(); const isHidden = headerUserPanel.classList.contains('hidden'); closeAllHeaderMenus(); if (isHidden) headerUserPanel.classList.remove('hidden'); });

    // Close menus on outside click globally
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#header-search-panel') && !e.target.closest('#header-search-btn')) headerSearchPanel?.classList.add('hidden');
        if (!e.target.closest('#header-notifications-panel') && !e.target.closest('#header-bell-btn')) headerNotifPanel?.classList.add('hidden');
        if (!e.target.closest('#header-user-panel') && !e.target.closest('#header-user-menu-btn')) headerUserPanel?.classList.add('hidden');
    });

    searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value;
        if (currentSearch) searchClear.classList.remove('hidden');
        else searchClear.classList.add('hidden');
        renderAllTasksList(store.state);
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        currentSearch = '';
        searchClear.classList.add('hidden');
        renderAllTasksList(store.state);
    });

    // Refresh Dashboard button
    document.getElementById('refresh-dashboard-btn').addEventListener('click', () => {
        document.getElementById('global-loader').classList.remove('hidden');
        store.init().then(() => {
            document.getElementById('global-loader').classList.add('hidden');
            showNotification('Refreshed', 'Dashboard data has been synchronized.', 'success');
        });
    });

    // Bulk actions
    document.getElementById('btn-bulk-actions').addEventListener('click', () => {
        document.getElementById('bulk-actions-menu').classList.toggle('hidden');
    });

    // Hide bulk menu on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#btn-bulk-actions') && !e.target.closest('#bulk-actions-menu')) {
            document.getElementById('bulk-actions-menu')?.classList.add('hidden');
        }
    });

    document.querySelectorAll('.bulk-action').forEach(action => {
        action.addEventListener('click', async (e) => {
            e.preventDefault();
            document.getElementById('bulk-actions-menu').classList.add('hidden');
            const type = e.target.getAttribute('data-action');

            const selectedIds = Array.from(document.querySelectorAll('.task-checkbox:checked')).map(cb => parseInt(cb.value));

            if (type === 'delete' && selectedIds.length > 0) {
                if (confirm(`Are you sure you want to delete ${selectedIds.length} tasks?`)) {
                    await store.deleteTasks(selectedIds);
                    showNotification('Deleted', `${selectedIds.length} tasks deleted successfully.`, 'success');
                }
            }
        });
    });

    // Export actions
    document.getElementById('btn-export-dropdown')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('export-actions-menu').classList.toggle('hidden');
    });

    document.getElementById('btn-export-csv')?.addEventListener('click', (e) => {
        e.preventDefault();
        exportTasksCSV(store.state.tasks);
        document.getElementById('export-actions-menu').classList.add('hidden');
    });

    document.getElementById('btn-export-pdf')?.addEventListener('click', (e) => {
        e.preventDefault();

        const tasks = store.state.tasks;
        const printWindow = window.open('', '', 'width=1000,height=800');

        let printHtml = `
            <html><head><title>WeRunOps Tasks Export</title>
            <style>
                body { font-family: system-ui, sans-serif; padding: 20px; color: #333; }
                h1 { border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 20px; }
                table { border-collapse: collapse; width: 100%; font-size: 13px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
                th { background-color: #f9fafb; font-weight: 600; color: #4B5563; }
                .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
            </style>
            </head><body>
            <h1>WeRunOps Task Export</h1>
            <div class="meta">Exported on: ${new Date().toLocaleString()} &bull; Total Tasks: ${tasks.length}</div>
            <table>
            <thead><tr>
                <th>ID</th><th>Client</th><th>Project</th><th>Task Name</th><th>Staff</th><th>Status</th><th>Priority</th><th>Due Date</th>
            </tr></thead><tbody>
        `;

        tasks.sort((a, b) => a.id - b.id).forEach(t => {
            printHtml += `<tr>
                <td style="color:#6B7280">#${t.id}</td>
                <td><strong>${t.client}</strong></td>
                <td>${t.project || '-'}</td>
                <td>${t.task}</td>
                <td>${t.staff}</td>
                <td>${t.status}</td>
                <td>${t.priority}</td>
                <td>${formatDate(t.dueDate)}</td>
            </tr>`;
        });

        printHtml += '</tbody></table></body></html>';

        printWindow.document.open();
        printWindow.document.write(printHtml);
        printWindow.document.close();

        printWindow.setTimeout(() => {
            printWindow.print();
        }, 500);

        document.getElementById('export-actions-menu').classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#btn-export-dropdown') && !e.target.closest('#export-actions-menu')) {
            document.getElementById('export-actions-menu')?.classList.add('hidden');
        }
    });
}

window.deleteSingleTask = async function (taskId) {
    if (confirm(`Are you sure you want to delete Task #${taskId}?`)) {
        await store.deleteTasks([taskId]);
        showNotification('Deleted', `Task #${taskId} deleted successfully.`, 'success');
    }
}

function exportTasksCSV(tasks) {
    let csv = 'ID,Client,Project,Task,Staff,Status,Priority,Due Date\\n';
    tasks.forEach(t => {
        csv += `"${t.id}","${t.client}","${t.project || ''}","${t.task}","${t.staff}","${t.status}","${t.priority}","${t.dueDate}"\\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `werunops-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function initModals() {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const taskModal = document.getElementById('modal-task');
    const form = document.getElementById('task-form');

    // Open standard task modal
    document.querySelectorAll('.btn-add-task').forEach(btn => {
        btn.addEventListener('click', () => openTaskModal(null));
    });

    // Close Modals
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', closeTaskModal);
    });

    // Close on backdrop click
    modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeTaskModal();
    });

    // Form Submit
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // UI Loading State
        const submitBtn = document.getElementById('btn-save-task');
        const spinner = document.getElementById('save-task-spinner');
        submitBtn.disabled = true;
        spinner.classList.remove('hidden');
        document.getElementById('save-task-text').textContent = 'Saving...';

        const formData = new FormData(form);
        const taskData = Object.fromEntries(formData.entries());

        try {
            await store.saveTask(taskData);
            closeTaskModal();
            showNotification('Success', `Task successfully saved.`, 'success');
        } catch (error) {
            showNotification('Error', 'Failed to save task. Please try again.', 'error');
            console.error(error);
        } finally {
            submitBtn.disabled = false;
            spinner.classList.add('hidden');
            document.getElementById('save-task-text').textContent = 'Save Task';
        }
    });

    // Client Form Handlers
    const clientModalBackdrop = document.getElementById('modal-client');
    const clientForm = document.getElementById('client-form');

    document.getElementById('btn-add-client')?.addEventListener('click', () => openClientModal(null));

    document.querySelectorAll('.btn-close-client-modal').forEach(btn => {
        btn.addEventListener('click', closeClientModal);
    });

    clientForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = document.getElementById('btn-save-client');
        const spinner = document.getElementById('save-client-spinner');
        submitBtn.disabled = true;
        spinner.classList.remove('hidden');
        document.getElementById('save-client-text').textContent = 'Saving...';

        const formData = new FormData(clientForm);
        const submitData = Object.fromEntries(formData.entries());
        submitData.originalName = document.getElementById('client-original-name').value;

        try {
            await store.saveClient(submitData);
            closeClientModal();
            showNotification('Success', `Client successfully saved.`, 'success');
        } catch (error) {
            showNotification('Error', 'Failed to save client.', 'error');
            console.error(error);
        } finally {
            submitBtn.disabled = false;
            spinner.classList.add('hidden');
            document.getElementById('save-client-text').textContent = 'Save Client';
        }
    });

    // Follow-up Clear Action
    document.getElementById('btn-clear-relationship')?.addEventListener('click', () => {
        document.getElementById('task-parent-id').value = '';
        document.getElementById('task-relationship-container').classList.add('hidden');
    });

    // Trigger Add Follow-up from within task modal
    document.getElementById('btn-add-followup')?.addEventListener('click', () => {
        const currentTaskId = parseInt(document.getElementById('task-id').value);
        const task = store.state.tasks.find(t => t.id === currentTaskId);
        if (task) {
            closeTaskModal();
            setTimeout(() => {
                openTaskModal(null, {
                    parentId: task.id,
                    client: task.client,
                    project: task.project || '',
                    staff: task.staff,
                    taskName: `Follow up on: ${task.task}`
                });
            }, 350); // wait for modal close transition
        }
    });
}

window.openTaskModal = function (taskId = null, defaults = {}) {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const taskModal = document.getElementById('modal-task');
    const form = document.getElementById('task-form');
    form.reset();

    const fields = ['task-client', 'task-project', 'task-name', 'task-staff', 'task-status', 'task-priority', 'task-start-date', 'task-due-date', 'task-waiting', 'task-notes'];
    fields.forEach(f => {
        const el = document.getElementById(f);
        if (el) {
            el.disabled = false;
            el.classList.remove('bg-gray-50', 'text-gray-500', 'cursor-not-allowed', 'border-transparent');
            el.classList.add('border-gray-300');
        }
    });
    document.getElementById('btn-save-task').classList.remove('hidden');

    document.getElementById('task-activity-container').classList.add('hidden');
    document.getElementById('task-children-container').classList.add('hidden');
    document.getElementById('modal-priority-display').classList.add('hidden');
    document.getElementById('task-relationship-container').classList.add('hidden');
    document.getElementById('btn-add-followup')?.classList.add('hidden');
    document.getElementById('task-parent-id').value = '';

    if (taskId) {
        // Edit mode
        document.getElementById('modal-task-title').textContent = 'Edit Task';
        document.getElementById('modal-task-id').textContent = `#${taskId}`;
        document.getElementById('modal-task-id').classList.remove('hidden');

        const task = store.state.tasks.find(t => t.id === parseInt(taskId));
        if (task) {
            document.getElementById('btn-add-followup')?.classList.remove('hidden');

            // Link visualization check
            if (task.parentId) {
                document.getElementById('task-parent-id').value = task.parentId;
                document.getElementById('task-relationship-text').textContent = `Following up on task #${task.parentId}`;
                document.getElementById('task-relationship-container').classList.remove('hidden');
            }

            // Populate form
            document.getElementById('task-id').value = task.id;
            document.getElementById('task-client').value = task.client;
            document.getElementById('task-project').value = task.project || '';
            document.getElementById('task-name').value = task.task;
            document.getElementById('task-staff').value = task.staff;
            document.getElementById('task-status').value = task.status;
            document.getElementById('task-priority').value = task.priority;

            if (task.startDate) document.getElementById('task-start-date').value = task.startDate.split('T')[0];
            if (task.dueDate) document.getElementById('task-due-date').value = task.dueDate.split('T')[0];

            document.getElementById('task-waiting').value = task.waitingFor || '';
            document.getElementById('task-notes').value = task.notes || '';

            // Priority badge
            const prioDisplay = document.getElementById('modal-priority-display');
            prioDisplay.innerHTML = `<span class="bg-priority-${task.priority} text-priority-${task.priority} px-3 py-1 rounded-full text-xs font-bold border border-priority-${task.priority} border-opacity-20">${task.priority}</span>`;
            prioDisplay.classList.remove('hidden');

            // Activity Log
            if (task.activityLog && task.activityLog.length > 0) {
                const logContainer = document.getElementById('task-activity-container');
                const logList = document.getElementById('task-activity-log');

                let logHtml = '';
                [...task.activityLog].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(log => {
                    logHtml += `
                        <li class="relative pl-6 md:pl-0">
                            <div class="hidden md:block absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-primary border-4 border-white"></div>
                            <div class="md:w-[calc(50%-1.5rem)] md:ml-auto bg-gray-50 border border-gray-100 p-3 rounded shadow-sm text-sm">
                                <span class="font-semibold text-gray-800">${log.user}</span>: ${log.action}
                                <div class="text-xs text-gray-400 mt-1">${formatDate(log.timestamp)} at ${new Date(log.timestamp).toLocaleTimeString()}</div>
                            </div>
                        </li>
                    `;
                });
                logList.innerHTML = logHtml;
                logContainer.classList.remove('hidden');
            }

            // Follow up children logic
            const childrenTasks = store.state.tasks.filter(t => t.parentId == task.id);
            if (childrenTasks.length > 0) {
                const childContainer = document.getElementById('task-children-container');
                const childList = document.getElementById('task-children-list');

                childList.innerHTML = childrenTasks.map(c => `
                    <div class="bg-gray-50 border border-gray-100 p-2.5 rounded text-sm hover:border-primary border-opacity-40 hover:bg-white transition cursor-pointer flex justify-between items-center" onclick="closeTaskModal(); setTimeout(() => openTaskModal(${c.id}, {viewOnly: true}), 350)">
                        <div class="flex items-center gap-3">
                            <span class="status-badge ${getStatusColorClass(c.status)}">${c.status}</span>
                            <span class="font-semibold text-gray-800">#${c.id} ${c.task}</span>
                        </div>
                        <i data-lucide="chevron-right" class="w-4 h-4 text-gray-400"></i>
                    </div>
                `).join('');
                childContainer.classList.remove('hidden');
                lucide.createIcons({ root: childList });
            }
        }
    } else {
        // Add mode
        document.getElementById('modal-task-title').textContent = 'Add New Task';
        document.getElementById('modal-task-id').classList.add('hidden');
        document.getElementById('task-id').value = '';

        // Defaults
        if (defaults.status) {
            document.getElementById('task-status').value = defaults.status;
        }
        if (defaults.parentId) {
            document.getElementById('task-parent-id').value = defaults.parentId;
            document.getElementById('task-relationship-text').textContent = `Following up on task #${defaults.parentId}`;
            document.getElementById('task-relationship-container').classList.remove('hidden');

            document.getElementById('task-client').value = defaults.client;
            document.getElementById('task-project').value = defaults.project;
            document.getElementById('task-staff').value = defaults.staff;
            document.getElementById('task-name').value = defaults.taskName;
        }
    }

    if (defaults.viewOnly) {
        document.getElementById('modal-task-title').textContent = 'Task Details (Read-only)';
        document.getElementById('btn-save-task').classList.add('hidden');

        fields.forEach(f => {
            const el = document.getElementById(f);
            if (el) {
                el.disabled = true;
                el.classList.add('bg-gray-50', 'text-gray-500', 'cursor-not-allowed', 'border-transparent');
                el.classList.remove('border-gray-300');
            }
        });
    }

    // Show modal with animation
    modalBackdrop.classList.remove('hidden');
    // slight delay for transition class to take effect
    setTimeout(() => {
        modalBackdrop.classList.remove('opacity-0');
        taskModal.classList.remove('hidden');
        setTimeout(() => taskModal.classList.remove('scale-95'), 10);
    }, 10);

    document.body.classList.add('modal-open');
}

function closeTaskModal() {
    const modalBackdrop = document.getElementById('modal-backdrop');
    const taskModal = document.getElementById('modal-task');

    taskModal.classList.add('scale-95');
    modalBackdrop.classList.add('opacity-0');

    setTimeout(() => {
        modalBackdrop.classList.add('hidden');
        taskModal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    }, 300); // match duration-300
}

window.openClientModal = function (clientName = null) {
    const modalBackdrop = document.getElementById('modal-client');
    const form = document.getElementById('client-form');
    form.reset();
    document.getElementById('client-original-name').value = '';

    if (clientName) {
        document.getElementById('modal-client-title').textContent = 'Edit Client';
        const client = store.state.config.clients.find(c => c.name === clientName);
        if (client) {
            document.getElementById('client-original-name').value = client.name;
            document.getElementById('client-name').value = client.name;
            document.getElementById('client-contact').value = client.contact || '';
            document.getElementById('client-email').value = client.email || '';
            document.getElementById('client-phone').value = client.phone || '';
        }
    } else {
        document.getElementById('modal-client-title').textContent = 'Add New Client';
    }

    modalBackdrop.classList.remove('hidden');
    setTimeout(() => {
        modalBackdrop.classList.remove('opacity-0');
        modalBackdrop.querySelector('.bg-white').classList.remove('scale-95');
    }, 10);
    document.body.classList.add('modal-open');
}

function closeClientModal() {
    const modalBackdrop = document.getElementById('modal-client');
    const modalBox = modalBackdrop.querySelector('.bg-white');

    modalBox.classList.add('scale-95');
    modalBackdrop.classList.add('opacity-0');

    setTimeout(() => {
        modalBackdrop.classList.add('hidden');
        document.body.classList.remove('modal-open');
    }, 300);
}

function initFilters() {
    // Side panel toggle
    const filterOverlay = document.getElementById('side-panel-overlay');
    const filterPanel = document.getElementById('filter-panel');

    function openFilters() {
        filterOverlay.classList.remove('hidden');
        setTimeout(() => {
            filterOverlay.classList.remove('opacity-0');
            filterPanel.classList.remove('translate-x-full');
        }, 10);
        document.body.classList.add('modal-open');
    }

    function closeFilters() {
        filterPanel.classList.add('translate-x-full');
        filterOverlay.classList.add('opacity-0');
        setTimeout(() => {
            filterOverlay.classList.add('hidden');
            document.body.classList.remove('modal-open');
        }, 300);
    }

    document.querySelectorAll('.btn-filter-toggle').forEach(btn => btn.addEventListener('click', openFilters));
    document.querySelectorAll('.btn-close-filters').forEach(btn => btn.addEventListener('click', closeFilters));
    filterOverlay.addEventListener('click', closeFilters);

    const controls = document.getElementById('filter-controls');
    if (controls) {
        controls.innerHTML = `
            <p class="text-sm text-gray-500">Filter criteria can be customized here to refine task views across the application.</p>
        `;
    }
}

const DEFAULT_USERS = [
    { username: 'Eshwar', password: '110495', name: 'Pritheeswarar', role: 'Admin', initials: 'P' },
    { username: 'Mubarak', password: '6544332211', name: 'Mubarak', role: 'Manager', initials: 'M' },
    { username: 'Sudhar', password: '19091997', name: 'Sudharshan', role: 'User', initials: 'S' }
];

function getValidUsers() {
    const stored = localStorage.getItem('werunops_users');
    if (stored) return JSON.parse(stored);
    localStorage.setItem('werunops_users', JSON.stringify(DEFAULT_USERS));
    return DEFAULT_USERS;
}

// --- Auth & Header Features ---
function setupAuth() {
    const loginForm = document.getElementById('login-form');
    const viewLogin = document.getElementById('view-login');
    const mainHeader = document.getElementById('main-header');
    const mainContent = document.getElementById('main-content');
    const errorMsg = document.getElementById('login-error-msg');

    // Check for existing session
    const storedSession = localStorage.getItem('werunops_session');
    if (storedSession) {
        const sessionUser = JSON.parse(storedSession);
        const validUsers = getValidUsers();
        // verify session user still exists and password matches
        const user = validUsers.find(u => u.username === sessionUser.username && u.password === sessionUser.password);
        if (user) {
            currentUser = { ...user };
            viewLogin.classList.add('hidden');
            mainHeader.classList.remove('hidden');
            mainContent.classList.remove('hidden');
            updateHeaderProfile();
            // We intentionally don't drop a new login history row for a pure refresh
        } else {
            localStorage.removeItem('werunops_session');
        }
    }

    loginForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById('login-username').value.trim();
        const passwordInput = document.getElementById('login-password').value;
        const spinner = document.getElementById('login-spinner');
        const loginText = document.getElementById('login-text');
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        
        // Prevent double clicks
        if (submitBtn.disabled) return;
        
        submitBtn.disabled = true;
        spinner.classList.remove('hidden');
        loginText.textContent = 'Signing In...';
        if(errorMsg) errorMsg.classList.add('hidden');
        
        setTimeout(() => {
            const validUsers = getValidUsers();
            const user = validUsers.find(u => u.username.toLowerCase() === usernameInput.toLowerCase() && u.password === passwordInput);
            
            if (user) {
                currentUser = { ...user };
                
                // Track Login
                const loginTime = new Date().toISOString();
                currentUser.sessionStart = loginTime;
                localStorage.setItem('werunops_session', JSON.stringify(currentUser));
                
                viewLogin.classList.add('hidden');
                mainHeader.classList.remove('hidden');
                mainContent.classList.remove('hidden');
                
                updateHeaderProfile();
                showNotification('Welcome', `Successfully signed in as ${user.name}.`, 'success');
            } else {
                if(errorMsg) {
                    errorMsg.textContent = 'Invalid username or password.';
                    errorMsg.classList.remove('hidden');
                } else {
                    showNotification('Login Failed', 'Invalid username or password.', 'error');
                }
            }
            
            // Re-enable button
            submitBtn.disabled = false;
            spinner.classList.add('hidden');
            loginText.textContent = 'Sign In';
        }, 800);
    });

    document.getElementById('btn-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        
        if (currentUser && currentUser.sessionStart) {
            logSessionHistory(currentUser.username, currentUser.name, currentUser.sessionStart);
        }
        
        currentUser = null;
        localStorage.removeItem('werunops_session');
        
        viewLogin.classList.remove('hidden');
        mainHeader.classList.add('hidden');
        mainContent.classList.add('hidden');
        document.getElementById('login-password').value = '';
    });
}

function logSessionHistory(username, name, startTime) {
    const historyData = localStorage.getItem('werunops_history');
    let history = historyData ? JSON.parse(historyData) : [];
    
    const endTime = new Date();
    const start = new Date(startTime);
    const durationMs = endTime - start;
    
    // Format duration e.g. "2h 15m" or "5m 30s"
    const hours = Math.floor(durationMs / 3600000);
    const mins = Math.floor((durationMs % 3600000) / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    
    let durationStr = '';
    if (hours > 0) durationStr += `${hours}h `;
    if (mins > 0 || hours > 0) durationStr += `${mins}m `;
    durationStr += `${secs}s`;
    
    history.unshift({
        username,
        name,
        loginTime: startTime,
        logoutTime: endTime.toISOString(),
        duration: durationStr
    });
    
    // Keep max 100 logs
    if (history.length > 100) history = history.slice(0, 100);
    
    localStorage.setItem('werunops_history', JSON.stringify(history));
}

function updateHeaderProfile() {
    if (!currentUser) return;
    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const avatarEl = document.getElementById('header-avatar');
    if (nameEl) nameEl.textContent = currentUser.name;
    if (roleEl) roleEl.textContent = currentUser.role;
    if (avatarEl) avatarEl.textContent = currentUser.initials;
    
    const presenceList = document.getElementById('header-presence-list');
    if (presenceList) {
        const validUsers = getValidUsers();
        presenceList.innerHTML = validUsers.map(u => {
            const isMe = u.username === currentUser.username;
            const dotClass = isMe ? 'bg-green-500' : 'bg-gray-300';
            const textClass = isMe ? 'text-gray-800 font-medium' : 'text-gray-500';
            const meLabel = isMe ? ' <span class="text-[10px] text-gray-400 font-normal ml-1">(me)</span>' : '';
            return `
                <div class="flex items-center gap-2 py-1 px-2">
                    <span class="w-2 h-2 rounded-full ${dotClass}"></span>
                    <span class="text-xs ${textClass}">${u.name}${meLabel}</span>
                    <span class="text-[10px] text-gray-400 ml-auto border border-gray-200 px-1.5 py-0.5 rounded-full bg-white">${isMe ? 'Online' : 'Offline'}</span>
                </div>
            `;
        }).join('');
    }
}

function setupProfileModal() {
    const modalProfile = document.getElementById('modal-profile');
    const btnOpen = document.getElementById('btn-open-profile');
    const form = document.getElementById('profile-form');
    if (!modalProfile || !btnOpen) return;

    function closeProfile() {
        const modalBox = modalProfile.querySelector('.bg-white');
        modalBox.classList.add('scale-95');
        modalProfile.classList.add('opacity-0');
        setTimeout(() => {
            modalProfile.classList.add('hidden');
            document.body.classList.remove('modal-open');
        }, 300);
    }

    btnOpen.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('header-user-panel').classList.add('hidden');
        if (currentUser) {
            document.getElementById('profile-name').value = currentUser.name;
            document.getElementById('profile-role').value = currentUser.role;
            document.getElementById('profile-modal-avatar').textContent = currentUser.initials;
        }

        modalProfile.classList.remove('hidden');
        setTimeout(() => {
            modalProfile.classList.remove('opacity-0');
            modalProfile.querySelector('.bg-white').classList.remove('scale-95');
        }, 10);
        document.body.classList.add('modal-open');
    });

    document.querySelectorAll('.btn-close-profile-modal').forEach(btn => {
        btn.addEventListener('click', closeProfile);
    });

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('profile-name').value;
        const role = document.getElementById('profile-role').value;
        const spinner = document.getElementById('profile-save-spinner');

        spinner.classList.remove('hidden');
        document.getElementById('profile-save-text').textContent = 'Saving...';

        setTimeout(() => {
            if (currentUser) {
                currentUser.name = name;
                currentUser.role = role;
                currentUser.initials = name.charAt(0).toUpperCase();
            }
            updateHeaderProfile();

            spinner.classList.add('hidden');
            document.getElementById('profile-save-text').textContent = 'Save';
            closeProfile();
            showNotification('Profile Updated', 'Your profile info has been saved.', 'success');
        }, 500);
    });
}

function setupSettingsModal() {
    const modalSettings = document.getElementById('modal-settings');
    const btnOpen = document.getElementById('btn-open-settings');
    const form = document.getElementById('password-form');
    if (!modalSettings || !btnOpen) return;
    
    function closeSettings() {
        const modalBox = modalSettings.querySelector('.bg-white');
        modalBox.classList.add('scale-95');
        modalSettings.classList.add('opacity-0');
        setTimeout(() => {
            modalSettings.classList.add('hidden');
            document.body.classList.remove('modal-open');
        }, 300);
    }

    btnOpen.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('header-user-panel').classList.add('hidden');
        
        // Reset Password form
        if(form) {
            form.reset();
            const errorMsg = document.getElementById('password-error-msg');
            if(errorMsg) errorMsg.classList.add('hidden');
        }
        
        // Populate History
        const listEl = document.getElementById('login-history-list');
        const historyData = localStorage.getItem('werunops_history');
        if (listEl) {
            if (historyData) {
                const history = JSON.parse(historyData);
                listEl.innerHTML = history.map(h => `
                    <tr class="hover:bg-gray-50">
                        <td class="px-4 py-3 font-medium text-gray-900">${h.name}</td>
                        <td class="px-4 py-3">${new Date(h.loginTime).toLocaleString()}</td>
                        <td class="px-4 py-3">${new Date(h.logoutTime).toLocaleString()}</td>
                        <td class="px-4 py-3 text-gray-500">${h.duration}</td>
                    </tr>
                `).join('');
            } else {
                listEl.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-gray-500">No login history recorded yet.</td></tr>';
            }
        }
        
        modalSettings.classList.remove('hidden');
        setTimeout(() => {
            modalSettings.classList.remove('opacity-0');
            modalSettings.querySelector('.bg-white').classList.remove('scale-95');
        }, 10);
        document.body.classList.add('modal-open');
    });

    document.querySelectorAll('.btn-close-settings-modal').forEach(btn => {
        btn.addEventListener('click', closeSettings);
    });

    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!currentUser) return;
        
        const currentP = document.getElementById('current-password').value;
        const newP = document.getElementById('new-password').value;
        const confirmP = document.getElementById('confirm-password').value;
        const errorMsg = document.getElementById('password-error-msg');
        const spinner = document.getElementById('password-save-spinner');
        
        // Validate
        if (currentP !== currentUser.password) {
            errorMsg.textContent = 'Incorrect current password.';
            errorMsg.classList.remove('hidden');
            return;
        }
        
        if (newP !== confirmP) {
            errorMsg.textContent = 'New passwords do not match.';
            errorMsg.classList.remove('hidden');
            return;
        }
        
        errorMsg.classList.add('hidden');
        spinner.classList.remove('hidden');
        document.getElementById('password-save-text').textContent = 'Updating...';
        
        setTimeout(() => {
            const validUsers = getValidUsers();
            const userIndex = validUsers.findIndex(u => u.username === currentUser.username);
            
            if (userIndex !== -1) {
                validUsers[userIndex].password = newP;
                localStorage.setItem('werunops_users', JSON.stringify(validUsers));
                currentUser.password = newP;
                localStorage.setItem('werunops_session', JSON.stringify(currentUser));
                showNotification('Success', 'Password updated successfully.', 'success');
                closeSettings();
            }
            
            spinner.classList.add('hidden');
            document.getElementById('password-save-text').textContent = 'Update Password';
        }, 500);
    });
}

function setupHeaderFeatures() {
    const searchInput = document.getElementById('header-search-input');
    const resultsContainer = document.getElementById('header-search-results');

    searchInput?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (!query) {
            resultsContainer.innerHTML = '';
            resultsContainer.classList.add('hidden');
            return;
        }

        const matches = store.state.tasks.filter(t =>
            t.task.toLowerCase().includes(query) ||
            t.id.toString().includes(query) ||
            t.client.toLowerCase().includes(query)
        ).slice(0, 5);

        if (matches.length > 0) {
            resultsContainer.innerHTML = matches.map(t => `
                <div class="p-2 hover:bg-gray-50 cursor-pointer rounded border-b border-gray-50 border-last-none" onclick="openTaskModal(${t.id}, {viewOnly: true})">
                    <p class="text-xs text-primary font-medium">#${t.id} &bull; ${t.client}</p>
                    <p class="text-sm font-semibold text-gray-800 truncate">${t.task}</p>
                </div>
            `).join('');
        } else {
            resultsContainer.innerHTML = '<div class="p-3 text-center text-xs text-gray-500">No matching tasks found</div>';
        }
        resultsContainer.classList.remove('hidden');
    });
}

function updateNotifications() {
    const list = document.getElementById('notifications-list');
    const countBadge = document.getElementById('notification-count');
    const dot = document.getElementById('notification-dot');

    if (!list || !store.state || !store.state.tasks) return;

    const actionableTasks = store.state.tasks.filter(t =>
        t.status !== 'Completed' && (isOverdue(t.dueDate) || t.status === 'Follow Up')
    );

    if (actionableTasks.length > 0) {
        if (countBadge) countBadge.textContent = actionableTasks.length;
        if (dot) dot.classList.remove('hidden');

        list.innerHTML = actionableTasks.map(t => {
            const isOv = isOverdue(t.dueDate);
            return `
            <div class="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-50 transition" onclick="openTaskModal(${t.id}, {viewOnly: true})">
                <div class="flex items-start gap-3">
                    <div class="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isOv ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}">
                        <i data-lucide="${isOv ? 'alert-circle' : 'corner-down-right'}" class="w-3 h-3"></i>
                    </div>
                    <div>
                        <p class="text-xs font-semibold ${isOv ? 'text-red-600' : 'text-green-600'} mb-0.5">${isOv ? 'Overdue Task' : 'Follow Up Required'}</p>
                        <p class="text-sm text-gray-800 font-medium leading-tight mb-1">${t.task}</p>
                        <p class="text-xs text-gray-500">Due: ${formatDate(t.dueDate)} &bull; ${t.client}</p>
                    </div>
                </div>
            </div>
        `}).join('');
    } else {
        if (countBadge) countBadge.textContent = '0';
        if (dot) dot.classList.add('hidden');
        list.innerHTML = `
            <div class="p-4 text-center text-sm text-gray-500">
                <i data-lucide="inbox" class="w-8 h-8 mx-auto text-gray-300 mb-2"></i>
                No new notifications.
            </div>
        `;
    }
    lucide.createIcons({ root: list });
}
