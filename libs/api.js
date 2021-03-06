const { System16 } = require('./system16');
const fetch = require('node-fetch');
const AbortController = require('abort-controller');

const localStorage = {};

var electron = null;

var ProxyRequest = function (app = {}) {
  var self = this;

  var sign = function (data) {
    const signature = app.signature;

    if (signature) {
      data.signature = { ...signature };
    }

    return data;
  };

  var timeout = function (ms, promise, controller) {
    var cancelled = false;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (controller.signal.dontabortable) {
          return;
        }

        if (controller) {
          controller.abort();
        }
      }, ms);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((reason) => {
          clearTimeout(timer);

          reject(reason);
        });
    });
  };

  var direct = function (url, data) {
    var controller = new AbortController();

    var time = 30000;

    return timeout(time, directclear(url, data, controller.signal), controller);
  };

  var directclear = function (url, data, signal) {
    if (!data) data = {};

    var er = false;

    return fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json;charset=utf-8',
      },
      signal: signal,
      body: JSON.stringify(sign(data)),
    })
      .then((r) => {
        signal.dontabortable = true;

        if (!r.ok) {
          er = true;
        }

        return r.json();
      })
      .then((result) => {
        if (er) {
          return Promise.reject(result.error);
        }

        return Promise.resolve(result.data || {});
      })
      .catch((e) => {
        if (e.code == 20) {
          return Promise.reject({
            code: 408,
          });
        }

        return Promise.reject(e);
      });
  };

  self.rpc = function (url, method, parameters, options) {
    if (!method) return Promise.reject('method');

    var data = {};

    data.parameters = parameters || [];
    data.method = method;

    if (options) data.options = options;

    return direct(url + '/rpc/' + method, data);
  };

  self.fetch = function (url, path, data) {
    return direct(url + '/' + path, data);
  };

  return self;
};

var Node = function (meta, app /*, proxy ??*/) {
  var self = this;

  self.host = meta.host || '';
  self.port = meta.port || 0;
  self.wss = meta.wss || 0;

  self.id = self.host + ':' + self.port + ':' + self.wss;

  return self;
};

var Proxy16 = function (meta = {}, app = {}, api) {
  var self = this;
  var request = new ProxyRequest(app);

  self.system = new System16(app, self, meta.direct);

  self.host = meta.host || '';
  self.port = meta.port || 0;
  self.wss = meta.wss || 0;
  self.direct = meta.direct;
  self.user = meta.user || false;

  self.current = null; //current node

  self.id = self.host + ':' + self.port + ':' + self.wss;
  self.enabled = true;

  nodes = [];

  var state = {
    hash: [],
    tick: {},
  };

  var internal = {
    node: {
      manage: {
        addlist: function (metas) {
          metas.forEach((meta) => {
            this.add(meta);
          });
        },
        add: function (meta) {
          var node = new Node(meta, app);
          nodes.push(node);
        },
      },
    },
  };

  self.changeNode = function (node) {
    if (node && self.current.key != node.key) {
      self.current = node;

      app.platform.ws.reconnect();

      self.clbks.changednode.forEach(function (c) {
        c();
      });

      return true;
    }
  };

  self.export = function () {
    return {
      host: self.host,
      port: self.port,
      wss: self.wss,
      user: self.user,
    };
  };

  self.changed = function (settings) {
    var reconnectws = false;

    if (settings.ports || settings.host) {
      if ((settings.ports || {}).https) {
        self.port = settings.ports.https;
      }

      if ((settings.ports || {}).wss) {
        self.wss = settings.ports.wss;
        reconnectws = true;
      }

      if (settings.host) {
        self.host = settings.host;
        reconnectws = true;
      }

      var lastid = self.id;

      self.id = self.host + ':' + self.port + ':' + self.wss;

      var currentapi = app.api.get.currentstring();

      app.api.editinsaved(lastid, self);

      if (currentapi == lastid) {
        app.api.set.current(self.id, reconnectws);
      }
    }

    if (typeof settings.enabled != 'undefined') {
      self.enabled = settings.enabled;
    }

    if (settings.ssl) {
      reconnectws = true;
    }

    if (settings.firebase) {
    }

    self.clbks.changed.forEach(function (c) {
      c(settings);
    });

    return reconnectws;
  };

  self.api = {
    ping: () => {
      return self
        .fetch('ping')
        .then((r) => {
          self.ping = new Date();

          return Promise.resolve(r);
        })
        .catch((e) => {
          return Promise.reject(e);
        });
    },

    actualping: function () {
      var promise = null;

      if (!self.ping || self.ping.addSeconds(5) < new Date()) {
        promise = self.api.ping();
      } else {
        promise = Promise.resolve(true);
      }

      return promise.catch((e) => {
        return Promise.resolve(false);
      });
    },

    nodes: {
      canchange: function (node) {
        return self
          .fetch('nodes/canchange', { node }, 'wait')
          .then((r) => {
            return Promise.resolve(self.changeNode(r.node));
          })
          .catch((e) => {
            return Promise.resolve(false);
          });
      },

      select: function () {
        var fixednode = '';

        if (api && api.get.fixednode()) fixednode = api.get.fixednode();

        console.log('fixednode', fixednode);

        return self.fetch('nodes/select', { fixed: fixednode }).then((r) => {
          console.log('R', r);

          self.current = r.node;

          return Promise.resolve(r);
        });
      },
      get: () => {
        return self.fetch('nodes/get').then((r) => {
          internal.node.manage.addlist(r.nodes);

          return Promise.resolve(r);
        });
      },

      addlist: function (metas) {
        metas.forEach((meta) => {
          this.add(meta);
        });
      },

      add: function (meta) {
        var node = new Node(meta, app);

        if (!this.find(node.id)) {
          nodes.push(node);
        }
      },

      find: function (id) {
        return nodes.find((node) => node.id == id);
      },
    },
  };

  self.url = {
    https: () => {
      return 'https://' + self.host + ':' + self.port;
    },
    wss: () => {
      return 'wss://' + self.host + ':' + self.wss;
    },
  };

  self.rpc = function (method, parameters, options, trying) {
    if (!trying) trying = 0;

    if (!options) options = {};

    if (self.current) {
      options.node = self.current.key;
    }

    var promise = null;

    if (self.direct) {
      promise = self.system.rpc(method, parameters, options);
    } else {
      promise = request.rpc(self.url.https(), method, parameters, options);
    }

    return promise
      .then((r) => {
        return Promise.resolve(r);
      })
      .catch((e) => {
        console.log('E', e);

        if (e.code == 408 && options.node && trying < 3) {
          return self.api.nodes.canchange(options.node).then((r) => {
            if (r) {
              return self.rpc(method, parameters, options, trying + 1);
            }

            return Promise.reject(e);
          });
        }

        return Promise.reject(e);
      });
  };

  var wait = {};

  self.fetch = function (path, data, waiting) {
    var promise = null;

    if (self.direct) {
      promise = self.system.fetch(path, data);
    } else {
      promise = request.fetch(self.url.https(), path, data);
    }

    return promise.then((r) => {
      return Promise.resolve(r);
    });
  };

  self.get = {
    nodes: () => nodes,

    name: function () {
      if (self.direct) return 'Electron Proxy';
      else return self.url.https();
    },

    info: function () {
      return self.fetch('info');
    },

    stats: function () {
      return self.fetch('stats');
    },
  };

  self.valid = function () {
    return self.host && self.port && self.wss;
  };

  self.init = function () {
    if (self.direct) {
      self.system.listen();
    }

    self.system.clbks.tick.proxy = function (settings, proxystate) {
      if (!proxystate) return;

      var hash = bitcoin.crypto.hash256(JSON.stringify(proxystate));

      var change = hash.join('') !== state.hash.join('');

      state.hash = hash;
      state.tick = proxystate;

      self.clbks.tick.forEach((c) => {
        c(state.tick, change);
      });
    };

    return self.refreshNodes();
  };

  self.refreshNodes = function () {
    return self.api.nodes
      .get()
      .then((r) => {
        return self.api.nodes.select();
      })
      .catch((e) => {
        return Promise.resolve();
      });
  };

  self.destroy = function () {
    if (self.direct) self.system.stop();

    nodes = [];
  };

  self.clbks = {
    tick: {},
    changed: {},
    changednode: {},
  };

  return self;
};

var Api = function (app = {}) {
  var self = this;

  var proxies = [];
  var nodes = [];

  var current = null; // 'localhost:8888:8088' //null;///'pocketnet.app:8899:8099'
  var useproxy = true;
  var inited = false;
  var fixednode = null;

  var getproxyas = function (key) {
    if (!key) {
      key = current;
    }

    if (key && typeof key === 'object') return key;

    var proxy = proxies.find(function (p) {
      return p.id == key;
    });

    if (!proxy && proxies[0]) return proxies[0];

    return proxy;
  };

  var getproxy = function (key) {
    var proxy = getproxyas();

    return proxy ? Promise.resolve(proxy) : Promise.reject('proxy');
  };

  self.addproxy = function (meta) {
    var lsproxies = JSON.parse(localStorage['listofproxies'] || '[]');

    var proxy = internal.proxy.manage.add(meta);

    if (proxy) {
      lsproxies.push(meta);

      internal.proxy.manage.savelist(lsproxies);

      return proxy;
    }
  };

  self.removeproxy = function (key) {
    var lsproxies = JSON.parse(localStorage['listofproxies'] || '[]');

    lsproxies = lsproxies.filter(function (meta) {
      var proxy = new Proxy16(meta, app);

      if (proxy.id == key) return false;

      return true;
    });

    proxies = proxies.filter(function (proxy) {
      if (proxy.id != key || proxy.direct) return true;
      else {
        proxy.destroy();
      }
    });

    if (current == key && proxies.length) current = proxies[0].id;

    internal.proxy.manage.savelist(lsproxies);
  };

  self.editinsaved = function (key, proxy) {
    var lsproxies = JSON.parse(localStorage['listofproxies'] || '[]');

    var proxyinlist = lsproxies.find(function (p) {
      var id = p.host + ':' + p.port + ':' + p.wss;

      return id == key;
    });

    if (proxyinlist) {
      proxyinlist.host = proxy.host;
      proxyinlist.port = proxy.port;
      proxyinlist.wss = proxy.wss;

      internal.proxy.manage.savelist(lsproxies);
    }
  };

  self.editproxy = function (key, meta) {
    var proxy = self.get.byid(key);

    proxy.changed({
      host: meta.host,
      ports: {
        https: meta.port,
        wss: meta.wss,
      },
    });

    return proxy;
  };

  var internal = {
    api: {
      manage: {},
    },
    proxy: {
      manage: {
        savelist: function (lsproxies) {
          localStorage['listofproxies'] = JSON.stringify(lsproxies || []);
        },
        init: function () {
          return this.addlocalelectronproxy()
            .then((r) => {
              this.addlist(deep(app, 'options.listofproxies') || []);

              try {
                this.addlist(JSON.parse(localStorage['listofproxies'] || '[]'));
              } catch (e) {}

              return Promise.resolve();
            })
            .then((r) => {
              var oldc = localStorage['currentproxy'];

              if (oldc) {
                return self.set.current(oldc);
              }

              return Promise.resolve();
            })
            .catch((e) => {
              return Promise.resolve();
            })
            .then(() => {
              if (!current && proxies.length) {
                current = 'pocketnet.app:8899:8099'; //proxies[0].id
              }

              console.log('current', current);

              inited = true;

              return Promise.resolve();
            });
        },
        addlocalelectronproxy: function () {
          if (electron) {
            var esystem = new System16(app, null, true);

            esystem.listen();

            return esystem.request('get.settings').then((settings) => {
              esystem.stop();

              this.add({
                direct: true,
                host: 'localhost',
                port: deep(settings, 'server.ports.https') || 0,
                wss: deep(settings, 'server.ports.wss') || 0,
              });

              return Promise.resolve();
            });
          } else {
            return Promise.resolve();
          }
        },
        addlist: function (metas) {
          metas.forEach((meta) => {
            this.add(meta);
          });
        },
        add: function (meta) {
          var proxy = new Proxy16(meta, app, self);

          if (!this.find(proxy.id) && (proxy.valid() || proxy.direct)) {
            proxies.push(proxy);
            proxy.init();

            return proxy;
          }
        },

        find: function (id) {
          return proxies.find((proxy) => proxy.id == id);
        },
      },

      api: {
        ping: function (proxies) {
          var promises = proxies.map((proxy) => {
            return proxy.api.ping();
          });

          return Promise.all(promises);
        },
      },
    },
  };

  self.rpc = function (method, parameters, options) {
    if (!method) return Promise.reject('method');

    if (!options) options = {};

    return getproxy(options.proxy)
      .then((proxy) => {
        return proxy.rpc(method, parameters, options.rpc);
      })
      .then((r) => {
        return Promise.resolve(r);
      })
      .catch((e) => {
        if (
          e == 'TypeError: Failed to fetch' ||
          e.code == 408 ||
          e.code == -28
        ) {
          app.apiHandlers.error({
            rpc: true,
          });
        }

        return Promise.reject(e);
      });
  };

  self.fetch = function (path, data, options) {
    if (!useproxy) return Promise.reject('useproxy');

    if (!options) options = {};

    return getproxy(options.proxy)
      .then((proxy) => {
        return proxy.fetch(path, data);
      })
      .then((r) => {
        app.apiHandlers.success({
          api: true,
        });

        return Promise.resolve(r);
      })
      .catch((e) => {
        console.log('ERROR', e);

        if (e == 'TypeError: Failed to fetch') {
          app.apiHandlers.error({
            api: true,
          });
        }

        return Promise.reject(e);
      });
  };

  self.ready = {
    proxies: () => {
      return proxies.filter((proxy) => {
        return proxy.ping;
      });
    },

    use: () => {
      console.log(
        'READY',
        useproxy
          ? proxies.filter((proxy) => {
              return proxy.ping && proxy.get.nodes().length;
            }).length || !proxies.length
          : false,
      );

      return useproxy
        ? proxies.filter((proxy) => {
            return proxy.ping && proxy.get.nodes().length;
          }).length || !proxies.length
        : false;
    },
  };

  self.wait = {
    ready: function (key, total) {
      if (!key) key = 'use';

      console.log('WAIT', total, key);

      return pretry(self.ready[key], 50, total);
    },
  };

  self.set = {
    current: function (ncurrent, reconnectws) {
      var proxy = self.get.byid(ncurrent);

      if (!proxy) return Promise.reject('hasnt');

      current = ncurrent;

      localStorage['currentproxy'] = current;

      if (reconnectws) app.platform.ws.reconnect();

      return Promise.resolve();

      if (r.refresh) {
        return proxy.refreshNodes();
      } else return Promise.resolve();
    },
    fixednode: function (id) {
      fixednode = id;

      localStorage['fixednode'] = fixednode;
    },
  };

  self.get = {
    fixednode: function () {
      return fixednode;
    },
    currentwss: function () {
      return getproxy().then((proxy) => {
        if (proxy.direct) {
          return {
            dummy: proxy.system.wssdummy,
            proxy: proxy,
          };
        }

        return {
          url: proxy.url.wss(),
          proxy: proxy,
        };
      });
    },
    proxies: function () {
      return proxies;
    },
    current: function () {
      return getproxyas();
    },

    currentstring: function () {
      return current;
    },

    byid: function (id) {
      return proxies.find(function (proxy) {
        return proxy.id == id;
      });
    },

    working: function () {
      var _proxies = proxies.filter(function (proxy) {
        return !proxy.direct;
      });

      var promises = _proxies.map(function (proxy) {
        return proxy.api.actualping();
      });

      return Promise.all(promises).then((r) => {
        return proxies.filter(function (p, i) {
          if (r[i]) {
            return true;
          }
        });
      });
    },
  };

  (self.changeProxyIfNeed = function () {
    var pr = getproxyas();
    var promise = null;

    if (pr) {
      promise = pr.api.actualping();
    } else {
      promise = Promise.resolve(false);
    }

    return promise.then((r) => {
      if (r) {
        return Promise.resolve();
      } else {
        return self.get.working().then((wproxies) => {
          if (wproxies.length) {
            self.set.current(wproxies[0].id);
          }

          return Promise.resolve();
        });
      }
    });
  }),
    (self.init = function () {
      var f = localStorage['fixednode'];

      if (f) fixednode = f;

      return internal.proxy.manage.init().then((r) => {
        internal.proxy.api.ping(proxies).catch((e) => {
          console.log('ERROR', e);
        });

        return Promise.resolve();
      });
    });

  self.initIf = function () {
    if (inited) return Promise.resolve();
    else return self.init();
  };

  self.destroy = function () {
    proxies = [];
    inited = false;
  };

  return self;
};

module.exports = { Api, ProxyRequest, Proxy16, Node };
