/* IndexedDB storage for forms the user builds in the browser. */
(function () {
  'use strict';
  var DB = null;

  function open() {
    if (DB) return Promise.resolve(DB);
    return new Promise(function (res, rej) {
      var req = indexedDB.open('formatic', 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('forms')) db.createObjectStore('forms', { keyPath: 'id' });
      };
      req.onsuccess = function () { DB = req.result; res(DB); };
      req.onerror = function () { rej(req.error); };
    });
  }

  function tx(mode) {
    return open().then(function (db) { return db.transaction('forms', mode).objectStore('forms'); });
  }

  window.FormaticStore = {
    put: function (rec) {
      return tx('readwrite').then(function (s) {
        return new Promise(function (res, rej) {
          var r = s.put(rec);
          r.onsuccess = function () { res(rec); };
          r.onerror = function () { rej(r.error); };
        });
      });
    },
    get: function (id) {
      return tx('readonly').then(function (s) {
        return new Promise(function (res, rej) {
          var r = s.get(id);
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { rej(r.error); };
        });
      });
    },
    all: function () {
      return tx('readonly').then(function (s) {
        return new Promise(function (res, rej) {
          var r = s.getAll();
          r.onsuccess = function () { res(r.result || []); };
          r.onerror = function () { rej(r.error); };
        });
      });
    },
    remove: function (id) {
      return tx('readwrite').then(function (s) {
        return new Promise(function (res, rej) {
          var r = s.delete(id);
          r.onsuccess = function () { res(true); };
          r.onerror = function () { rej(r.error); };
        });
      });
    }
  };
})();
