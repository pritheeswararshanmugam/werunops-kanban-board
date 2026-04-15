(function attachWeRunOpsPersistence(global) {
    if (global.WERUNOPS_PERSISTENCE) {
        return;
    }

    const DATABASE_NAME = 'werunops-browser-cache';
    const STORE_NAME = 'keyValue';

    class BrowserPersistence {
        constructor() {
            this.dbPromise = null;
            this.cache = new Map();
            this.hydratedKeys = new Set();
            this.writeQueue = Promise.resolve();
            this.indexedDbSupported = typeof global.indexedDB !== 'undefined';
        }

        async hydrate(keys = []) {
            const uniqueKeys = [...new Set((Array.isArray(keys) ? keys : []).filter(Boolean))];
            if (!uniqueKeys.length) return;

            const db = await this.openDatabase();
            await Promise.all(uniqueKeys.map(async (key) => {
                let value = db ? await this.readFromIndexedDb(db, key) : undefined;

                if (value === undefined) {
                    value = this.readFromLocalStorage(key);
                    if (value !== null && db) {
                        try {
                            await this.writeToIndexedDb(db, key, value);
                            this.removeFromLocalStorage(key);
                        } catch (error) {
                            this.writeToLocalStorage(key, value);
                        }
                    }
                }

                this.cache.set(key, value ?? null);
                this.hydratedKeys.add(key);
            }));
        }

        getString(key) {
            if (!key) return null;
            if (this.hydratedKeys.has(key)) {
                return this.cache.get(key) ?? null;
            }

            const value = this.readFromLocalStorage(key);
            this.cache.set(key, value ?? null);
            this.hydratedKeys.add(key);
            return value ?? null;
        }

        setString(key, value) {
            if (!key) return Promise.resolve();

            const normalizedValue = value == null ? null : String(value);
            this.cache.set(key, normalizedValue);
            this.hydratedKeys.add(key);

            return this.enqueueWrite(async () => {
                const db = await this.openDatabase();
                if (!db) {
                    this.writeToLocalStorage(key, normalizedValue);
                    return;
                }

                try {
                    if (normalizedValue === null) {
                        await this.deleteFromIndexedDb(db, key);
                    } else {
                        await this.writeToIndexedDb(db, key, normalizedValue);
                    }
                    this.removeFromLocalStorage(key);
                } catch (error) {
                    this.writeToLocalStorage(key, normalizedValue);
                }
            });
        }

        getJSON(key, fallbackValue = null) {
            const raw = this.getString(key);
            if (!raw) return fallbackValue;

            try {
                return JSON.parse(raw);
            } catch (error) {
                return fallbackValue;
            }
        }

        setJSON(key, value) {
            return this.setString(key, JSON.stringify(value));
        }

        enqueueWrite(work) {
            this.writeQueue = this.writeQueue
                .then(() => work())
                .catch((error) => {
                    console.warn('Persistence write failed:', error);
                });
            return this.writeQueue;
        }

        readFromLocalStorage(key) {
            try {
                return global.localStorage.getItem(key);
            } catch (error) {
                return null;
            }
        }

        writeToLocalStorage(key, value) {
            try {
                if (value === null) {
                    global.localStorage.removeItem(key);
                    return;
                }
                global.localStorage.setItem(key, value);
            } catch (error) {
                console.warn('localStorage write failed:', error);
            }
        }

        removeFromLocalStorage(key) {
            try {
                global.localStorage.removeItem(key);
            } catch (error) {
                console.warn('localStorage cleanup failed:', error);
            }
        }

        async openDatabase() {
            if (!this.indexedDbSupported) {
                return null;
            }

            if (this.dbPromise) {
                return this.dbPromise;
            }

            this.dbPromise = new Promise((resolve) => {
                const request = global.indexedDB.open(DATABASE_NAME, 1);

                request.onerror = () => resolve(null);
                request.onblocked = () => resolve(null);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME);
                    }
                };
                request.onsuccess = () => {
                    const db = request.result;
                    db.onversionchange = () => db.close();
                    resolve(db);
                };
            });

            return this.dbPromise;
        }

        readFromIndexedDb(db, key) {
            return new Promise((resolve) => {
                try {
                    const transaction = db.transaction(STORE_NAME, 'readonly');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.get(key);

                    request.onsuccess = () => resolve(request.result === undefined ? undefined : request.result);
                    request.onerror = () => resolve(undefined);
                } catch (error) {
                    resolve(undefined);
                }
            });
        }

        writeToIndexedDb(db, key, value) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(STORE_NAME, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.put(value, key);

                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error || new Error('IndexedDB write failed'));
                } catch (error) {
                    reject(error);
                }
            });
        }

        deleteFromIndexedDb(db, key) {
            return new Promise((resolve, reject) => {
                try {
                    const transaction = db.transaction(STORE_NAME, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.delete(key);

                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error || new Error('IndexedDB delete failed'));
                } catch (error) {
                    reject(error);
                }
            });
        }
    }

    global.WERUNOPS_PERSISTENCE = new BrowserPersistence();
})(window);