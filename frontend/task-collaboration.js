(function attachWeRunOpsTaskCollaboration(global) {
    if (global.WeRunOpsTaskCollaboration) {
        return;
    }

    const LOCK_REFRESH_INTERVAL_MS = 30000;

    function getTaskLockInfo(taskLocks, taskId, currentUsername) {
        if (!taskLocks) return null;
        const lock = taskLocks[parseInt(taskId)];
        if (!lock) return null;
        if (lock.lockedBy === currentUsername) return null;
        return lock;
    }

    function getLockOwnerLabel(lockInfo) {
        return lockInfo?.lockedByName || lockInfo?.lockedBy || 'Another teammate';
    }

    function buildSharedEditingMessage(lockInfo) {
        return `${getLockOwnerLabel(lockInfo)} is already editing this task. You can keep editing, but review the latest version before saving if someone else updates it first.`;
    }

    function describeTaskChangeError(error, actionLabel = 'update this task', fallbackMessage = '') {
        if (error?.detail?.code === 'TASK_CONFLICT') {
            return {
                title: 'Task Updated Elsewhere',
                message: 'A newer version of this task was saved by someone else. Review the latest values, then retry your change.',
                level: 'warning'
            };
        }

        if (error?.detail?.code === 'TASK_LOCKED') {
            return {
                title: 'Shared Editing',
                message: buildSharedEditingMessage(error.detail),
                level: 'warning'
            };
        }

        return {
            title: 'Update Failed',
            message: fallbackMessage || `Unable to ${actionLabel} right now.`,
            level: 'error'
        };
    }

    async function startTaskEditSession(store, taskId, currentUsername) {
        const normalizedTaskId = parseInt(taskId);
        const session = {
            taskId: Number.isFinite(normalizedTaskId) ? normalizedTaskId : null,
            lockAcquired: false,
            refreshTimer: null,
            warning: ''
        };

        if (!session.taskId || !store?.isBackendReady?.()) {
            return session;
        }

        try {
            await store.acquireTaskLock(session.taskId, 75);
            session.lockAcquired = true;
            session.refreshTimer = setInterval(() => {
                store.acquireTaskLock(session.taskId, 75).catch(() => {});
            }, LOCK_REFRESH_INTERVAL_MS);
        } catch (error) {
            await store.fetchTaskLocks?.().catch(() => {});
            if (error?.detail?.code === 'TASK_LOCKED') {
                const advisoryLock = getTaskLockInfo(store?.state?.taskLocks, session.taskId, currentUsername) || error.detail;
                session.warning = buildSharedEditingMessage(advisoryLock);
            } else {
                session.warning = 'Live edit presence could not be confirmed. You can still edit, but refresh if anything looks stale.';
            }
        }

        return session;
    }

    async function stopTaskEditSession(store, session) {
        if (!session) return;

        if (session.refreshTimer) {
            clearInterval(session.refreshTimer);
        }

        if (session.lockAcquired && session.taskId && store?.releaseTaskLock) {
            await store.releaseTaskLock(session.taskId).catch(() => {});
        }
    }

    global.WeRunOpsTaskCollaboration = {
        getTaskLockInfo,
        describeTaskChangeError,
        startTaskEditSession,
        stopTaskEditSession
    };
})(window);