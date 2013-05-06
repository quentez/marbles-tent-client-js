/*
    HTTP Hawk Authentication Scheme
    Copyright (c) 2012-2013, Eran Hammer <eran@hueniverse.com>
    MIT Licensed
*/

// Declare namespace

var hawk = {};


// Export if used as a module

if (typeof module !== "undefined" && module.exports) {
    module.exports = hawk;
}

(function() {
  hawk.utils = {

      storage: {                                      // localStorage compatible interface
          _cache: {},
          setItem: function (key, value) {

              hawk.utils.storage._cache[key] = value;
          },
          getItem: function (key) {

              return hawk.utils.storage._cache[key];
          }
      },

      setStorage: function (storage) {

          var ntpOffset = hawk.utils.getNtpOffset() || 0;
          hawk.utils.storage = storage;
          hawk.utils.setNtpOffset(ntpOffset);
      },

      setNtpOffset: function (offset) {

          hawk.utils.storage.setItem('hawk_ntp_offset', offset);
      },

      getNtpOffset: function () {

          return parseInt(hawk.utils.storage.getItem('hawk_ntp_offset') || '0', 10);
      },

      now: function () {

          return Date.now() + hawk.utils.getNtpOffset();
      },

      escapeHeaderAttribute: function (attribute) {

          return attribute.replace(/\\/g, '\\\\').replace(/\"/g, '\\"');
      },

      parseContentType: function (header) {

          if (!header) {
              return '';
          }

          return header.split(';')[0].trim().toLowerCase();
      },

      parseAuthorizationHeader: function (header, keys) {

          if (!header) {
              return null;
          }

          var headerParts = header.match(/^(\w+)(?:\s+(.*))?$/);       // Header: scheme[ something]
          if (!headerParts) {
              return null;
          }

          var scheme = headerParts[1];
          if (scheme.toLowerCase() !== 'hawk') {
              return null;
          }

          var attributesString = headerParts[2];
          if (!attributesString) {
              return null;
          }

          var attributes = {};
          var verify = attributesString.replace(/(\w+)="([^"\\]*)"\s*(?:,\s*|$)/g, function ($0, $1, $2) {

              // Check valid attribute names

              if (keys.indexOf($1) === -1) {
                  return;
              }

              // Allowed attribute value characters: !#$%&'()*+,-./:;<=>?@[]^_`{|}~ and space, a-z, A-Z, 0-9

              if ($2.match(/^[ \w\!#\$%&'\(\)\*\+,\-\.\/\:;<\=>\?@\[\]\^`\{\|\}~]+$/) === null) {
                  return;
              }

              // Check for duplicates

              if (attributes.hasOwnProperty($1)) {
                  return;
              }

              attributes[$1] = $2;
              return '';
          });

          if (verify !== '') {
              return null;
          }

          return attributes;
      },

      randomString: function (size) {

          var randomSource = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          var len = randomSource.length;

          var result = [];
          for (var i = 0; i < size; ++i) {
              result[i] = randomSource[Math.floor(Math.random() * len)];
          }

          return result.join('');
      },

      parseUri: function (input) {

          // Based on: parseURI 1.2.2
          // http://blog.stevenlevithan.com/archives/parseuri
          // (c) Steven Levithan <stevenlevithan.com>
          // MIT License

          var keys = ['source', 'protocol', 'authority', 'userInfo', 'user', 'password', 'hostname', 'port', 'resource', 'relative', 'pathname', 'directory', 'file', 'search', 'hash'];

          var uriRegex = /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?(((((?:[^?#\/]*\/)*)([^?#]*))(\?[^#]*)?)(#.*)?)/;
          var uriByNumber = uriRegex.exec(input);
          var uri = {};

          var i = keys.length;
          while (i--) {
              uri[keys[i]] = uriByNumber[i] || '';
          }

          if (uri.port === null ||
              uri.port === '') {

              uri.port = (uri.protocol.toLowerCase() === 'http' ? '80' : (uri.protocol.toLowerCase() === 'https' ? '443' : ''));
          }

          return uri;
      },

      base64urlEncode: function(input) {
        return Base64.encode(input).replace("+/", "-_").replace("\n", '').replace(/=+$/, '')
      }
  };

  // hawk.Crypto
  (function(hawk) {
    // Load modules

    var Url = { parse: hawk.utils.parseUri };
    var Utils = hawk.utils;

    hawk.Crypto = {};
    var exports = hawk.Crypto;


    // Declare internals

    var internals = {};


    // MAC normalization format version

    exports.headerVersion = '1';                        // Prevent comparison of mac values generated with different normalized string formats


    // Supported HMAC algorithms

    exports.algorithms = ['sha1', 'sha256'];


    // Calculate the request MAC

    /*
        type: 'header',                                 // 'header', 'bewit', 'response'
        credentials: {
            key: 'aoijedoaijsdlaksjdl',
            algorithm: 'sha256'                         // 'sha1', 'sha256'
        },
        options: {
            method: 'GET',
            resource: '/resource?a=1&b=2',
            host: 'example.com',
            port: 8080,
            ts: 1357718381034,
            nonce: 'd3d345f',
            hash: 'U4MKKSmiVxk37JCCrAVIjV/OhB3y+NdwoCr6RShbVkE=',
            ext: 'app-specific-data',
            app: 'hf48hd83qwkj',                        // Application id (Oz)
            dlg: 'd8djwekds9cj'                         // Delegated by application id (Oz), requires options.app
        }
    */

    exports.calculateMac = function (type, credentials, options) {

        var normalized = exports.generateNormalizedString(type, options);
        var hmac = CryptoJS['Hmac' + credentials.algorithm.toUpperCase()](normalized, credentials.key);
        return hmac.toString(CryptoJS.enc.Base64);
    };


    exports.generateNormalizedString = function (type, options) {

        var normalized = 'hawk.' + exports.headerVersion + '.' + type + '\n' +
                         options.ts + '\n' +
                         options.nonce + '\n' +
                         options.method.toUpperCase() + '\n' +
                         options.resource + '\n' +
                         options.host.toLowerCase() + '\n' +
                         options.port + '\n' +
                         (options.hash || '') + '\n';

        if (options.ext) {
            normalized += options.ext.replace('\\', '\\\\').replace('\n', '\\n');
        }

        normalized += '\n';

        if (options.app) {
            normalized += options.app + '\n' +
                          (options.dlg || '') + '\n';
        }

        return normalized;
    };


    exports.calculatePayloadHash = function (payload, algorithm, contentType) {

        var hash = exports.initializePayloadHash(algorithm, contentType);
        hash.update(payload || '');
        return exports.finalizePayloadHash(hash);
    };


    exports.initializePayloadHash = function (algorithm, contentType) {

        var hash = CryptoJS.algo[algorithm.toUpperCase()].create();
        hash.update('hawk.' + exports.headerVersion + '.payload\n');
        hash.update(Utils.parseContentType(contentType) + '\n');
        return hash;
    };

    exports.finalizePayloadHash = function (hash) {

        hash.update('\n');
        return hash.finalize().toString(CryptoJS.enc.Base64);
    };


    exports.calculateTsMac = function (ts, credentials) {
        var hash = CryptoJS['Hmac' + credentials.algorithm.toUpperCase()]('hawk.' + exports.headerVersion + '.ts\n' + ts + '\n', credentials.key);
        return hash.toString(CryptoJS.enc.Base64);
    };

  })(hawk);

  // hawk.client
  (function (hawk) {
    // Load modules

    var Url = { parse: hawk.utils.parseUri };
    var Hoek = { clone: function(obj) { return obj } };
    var Cryptiles = { randomString: hawk.utils.randomString };
    var Utils = hawk.utils;
    var Crypto = hawk.Crypto;

    hawk.client = {};
    var exports = hawk.client;


    // Declare internals

    var internals = {};


    // Generate an Authorization header for a given request

    /*
        uri: 'http://example.com/resource?a=b' or object from Url.parse()
        method: HTTP verb (e.g. 'GET', 'POST')
        options: {

            // Required

            credentials: {
                id: 'dh37fgj492je',
                key: 'aoijedoaijsdlaksjdl',
                algorithm: 'sha256'                                 // 'sha1', 'sha256'
            },

            // Optional

            ext: 'application-specific',                        // Application specific data sent via the ext attribute
            timestamp: Date.now(),                              // A pre-calculated timestamp
            nonce: '2334f34f',                                  // A pre-generated nonce
            localtimeOffsetMsec: 400,                           // Time offset to sync with server time (ignored if timestamp provided)
            payload: '{"some":"payload"}',                      // UTF-8 encoded string for body hash generation (ignored if hash provided)
            contentType: 'application/json',                    // Payload content-type (ignored if hash provided)
            hash: 'U4MKKSmiVxk37JCCrAVIjV=',                    // Pre-calculated payload hash
            app: '24s23423f34dx',                               // Oz application id
            dlg: '234sz34tww3sd'                                // Oz delegated-by application id
        }
    */

    exports.header = function (uri, method, options) {

        var result = {
            field: '',
            artifacts: {}
        };

        // Validate inputs

        if (!uri || (typeof uri !== 'string' && typeof uri !== 'object') ||
            !method || typeof method !== 'string' ||
            !options || typeof options !== 'object') {

            return result;
        }

        // Application time

        var timestamp = options.timestamp || Math.floor((Utils.now() + (options.localtimeOffsetMsec || 0)) / 1000)

        // Validate credentials

        var credentials = options.credentials;
        if (!credentials ||
            !credentials.id ||
            !credentials.key ||
            !credentials.algorithm) {

            // Invalid credential object
            return result;
        }

        if (Crypto.algorithms.indexOf(credentials.algorithm) === -1) {
            return result;
        }

        // Parse URI

        if (typeof uri === 'string') {
            uri = Url.parse(uri);
        }

        // Calculate signature

        var artifacts = {
            ts: timestamp,
            nonce: options.nonce || Cryptiles.randomString(6),
            method: method,
            resource: uri.pathname + (uri.search || ''),                            // Maintain trailing '?'
            host: uri.hostname,
            port: uri.port || (uri.protocol === 'http:' ? 80 : 443),
            hash: options.hash,
            ext: options.ext,
            app: options.app,
            dlg: options.dlg
        };

        result.artifacts = artifacts;

        // Calculate payload hash

        if (!artifacts.hash &&
            options.hasOwnProperty('payload')) {

            artifacts.hash = Crypto.calculatePayloadHash(options.payload, credentials.algorithm, options.contentType);
        }

        var mac = Crypto.calculateMac('header', credentials, artifacts);

        // Construct header

        var hasExt = artifacts.ext !== null && artifacts.ext !== undefined && artifacts.ext !== '';       // Other falsey values allowed
        var header = 'Hawk id="' + credentials.id +
                     '", ts="' + artifacts.ts +
                     '", nonce="' + artifacts.nonce +
                     (artifacts.hash ? '", hash="' + artifacts.hash : '') +
                     (hasExt ? '", ext="' + Utils.escapeHeaderAttribute(artifacts.ext) : '') +
                     '", mac="' + mac + '"';

        if (artifacts.app) {
            header += ', app="' + artifacts.app +
                      (artifacts.dlg ? '", dlg="' + artifacts.dlg : '') + '"';
        }

        result.field = header;

        return result;
    };


    // Validate server response

    /*
        res:        node's response object
        artifacts:  object recieved from header().artifacts
        options: {
            payload:    optional payload received
            required:   specifies if a Server-Authorization header is required. Defaults to 'false'
        }
    */

    exports.authenticate = function (res, credentials, artifacts, options) {

        artifacts = Hoek.clone(artifacts);
        options = options || {};

        if (res.headers['www-authenticate']) {

            // Parse HTTP WWW-Authenticate header

            var attributes = Utils.parseAuthorizationHeader(res.headers['www-authenticate'], ['ts', 'tsm', 'error']);
            if (!attributes) {
                return false;
            }

            if (attributes.ts) {
                var tsm = Crypto.calculateTsMac(attributes.ts, credentials);
                if (tsm !== attributes.tsm) {
                    return false;
                }
                Utils.setNtpOffset(attributes.ts - Math.floor(Date.now() / 1000));     // Keep offset at 1 second precision
            }
        }

        // Parse HTTP Server-Authorization header

        if (!res.headers['server-authorization'] &&
            !options.required) {

            return true;
        }

        var attributes = Utils.parseAuthorizationHeader(res.headers['server-authorization'], ['mac', 'ext', 'hash']);
        if (!attributes) {
            return false;
        }

        artifacts.ext = attributes.ext;
        artifacts.hash = attributes.hash;

        var mac = Crypto.calculateMac('response', credentials, artifacts);
        if (mac !== attributes.mac) {
            return false;
        }

        if (!options.hasOwnProperty('payload')) {
            return true;
        }

        if (!attributes.hash) {
            return false;
        }

        var calculatedHash = Crypto.calculatePayloadHash(options.payload, credentials.algorithm, res.headers['content-type']);
        return (calculatedHash === attributes.hash);
    };


    // Generate a bewit value for a given URI

    /*
     * credentials is an object with the following keys: 'id, 'key', 'algorithm'.
     * options is an object with the following optional keys: 'ext', 'localtimeOffsetMsec'
     */
    /*
        uri: 'http://example.com/resource?a=b' or object from Url.parse()
        options: {

            // Required

            credentials: {
                id: 'dh37fgj492je',
                key: 'aoijedoaijsdlaksjdl',
                algorithm: 'sha256'                             // 'sha1', 'sha256'
            },
            ttlSec: 60 * 60,                                    // TTL in seconds

            // Optional

            ext: 'application-specific',                        // Application specific data sent via the ext attribute
            localtimeOffsetMsec: 400                            // Time offset to sync with server time
        };
    */

    exports.getBewit = function (uri, options) {

        // Validate inputs

        if (!uri ||
            (typeof uri !== 'string' && typeof uri !== 'object') ||
            !options ||
            typeof options !== 'object' ||
            !options.ttlSec) {

            return '';
        }

        options.ext = (options.ext === null || options.ext === undefined ? '' : options.ext);       // Zero is valid value

        // Application time

        var now = Utils.now() + (options.localtimeOffsetMsec || 0);

        // Validate credentials

        var credentials = options.credentials;
        if (!credentials ||
            !credentials.id ||
            !credentials.key ||
            !credentials.algorithm) {

            return '';
        }

        if (Crypto.algorithms.indexOf(credentials.algorithm) === -1) {
            return '';
        }

        // Parse URI

        if (typeof uri === 'string') {
            uri = Url.parse(uri);
        }

        // Calculate signature

        var exp = Math.floor(now / 1000) + options.ttlSec;
        var mac = Crypto.calculateMac('bewit', credentials, {
            ts: exp,
            nonce: '',
            method: 'GET',
            resource: uri.pathname + (uri.search || ''),                            // Maintain trailing '?'
            host: uri.hostname,
            port: uri.port || (uri.protocol === 'http:' ? 80 : 443),
            ext: options.ext
        });

        // Construct bewit: id\exp\mac\ext

        var bewit = credentials.id + '\\' + exp + '\\' + mac + '\\' + options.ext;
        return Utils.base64urlEncode(bewit);
    };

  })(hawk);

  // Based on: Crypto-JS v3.1.2
  // Copyright (c) 2009-2013, Jeff Mott. All rights reserved.
  // http://code.google.com/p/crypto-js/
  // http://code.google.com/p/crypto-js/wiki/License

  var CryptoJS=CryptoJS||function(h,r){var k={},l=k.lib={},n=function(){},f=l.Base={extend:function(a){n.prototype=this;var b=new n;a&&b.mixIn(a);b.hasOwnProperty("init")||(b.init=function(){b.$super.init.apply(this,arguments)});b.init.prototype=b;b.$super=this;return b},create:function(){var a=this.extend();a.init.apply(a,arguments);return a},init:function(){},mixIn:function(a){for(var b in a)a.hasOwnProperty(b)&&(this[b]=a[b]);a.hasOwnProperty("toString")&&(this.toString=a.toString)},clone:function(){return this.init.prototype.extend(this)}},j=l.WordArray=f.extend({init:function(a,b){a=this.words=a||[];this.sigBytes=b!=r?b:4*a.length},toString:function(a){return(a||s).stringify(this)},concat:function(a){var b=this.words,d=a.words,c=this.sigBytes;a=a.sigBytes;this.clamp();if(c%4)for(var e=0;e<a;e++)b[c+e>>>2]|=(d[e>>>2]>>>24-8*(e%4)&255)<<24-8*((c+e)%4);else if(65535<d.length)for(e=0;e<a;e+=4)b[c+e>>>2]=d[e>>>2];else b.push.apply(b,d);this.sigBytes+=a;return this},clamp:function(){var a=this.words,b=this.sigBytes;a[b>>>2]&=4294967295<<32-8*(b%4);a.length=h.ceil(b/4)},clone:function(){var a=f.clone.call(this);a.words=this.words.slice(0);return a},random:function(a){for(var b=[],d=0;d<a;d+=4)b.push(4294967296*h.random()|0);return new j.init(b,a)}}),m=k.enc={},s=m.Hex={stringify:function(a){var b=a.words;a=a.sigBytes;for(var d=[],c=0;c<a;c++){var e=b[c>>>2]>>>24-8*(c%4)&255;d.push((e>>>4).toString(16));d.push((e&15).toString(16))}return d.join("")},parse:function(a){for(var b=a.length,d=[],c=0;c<b;c+=2)d[c>>>3]|=parseInt(a.substr(c,2),16)<<24-4*(c%8);return new j.init(d,b/2)}},p=m.Latin1={stringify:function(a){var b=a.words;a=a.sigBytes;for(var d=[],c=0;c<a;c++)d.push(String.fromCharCode(b[c>>>2]>>>24-8*(c%4)&255));return d.join("")},parse:function(a){for(var b=a.length,d=[],c=0;c<b;c++)d[c>>>2]|=(a.charCodeAt(c)&255)<<24-8*(c%4);return new j.init(d,b)}},t=m.Utf8={stringify:function(a){try{return decodeURIComponent(escape(p.stringify(a)))}catch(b){throw Error("Malformed UTF-8 data");}},parse:function(a){return p.parse(unescape(encodeURIComponent(a)))}},q=l.BufferedBlockAlgorithm=f.extend({reset:function(){this._data=new j.init;this._nDataBytes=0},_append:function(a){"string"==typeof a&&(a=t.parse(a));this._data.concat(a);this._nDataBytes+=a.sigBytes},_process:function(a){var b=this._data,d=b.words,c=b.sigBytes,e=this.blockSize,f=c/(4*e),f=a?h.ceil(f):h.max((f|0)-this._minBufferSize,0);a=f*e;c=h.min(4*a,c);if(a){for(var g=0;g<a;g+=e)this._doProcessBlock(d,g);g=d.splice(0,a);b.sigBytes-=c}return new j.init(g,c)},clone:function(){var a=f.clone.call(this);a._data=this._data.clone();return a},_minBufferSize:0});l.Hasher=q.extend({cfg:f.extend(),init:function(a){this.cfg=this.cfg.extend(a);this.reset()},reset:function(){q.reset.call(this);this._doReset()},update:function(a){this._append(a);this._process();return this},finalize:function(a){a&&this._append(a);return this._doFinalize()},blockSize:16,_createHelper:function(a){return function(b,d){return(new a.init(d)).finalize(b)}},_createHmacHelper:function(a){return function(b,d){return(new u.HMAC.init(a,d)).finalize(b)}}});var u=k.algo={};return k}(Math);
  (function () { var k = CryptoJS, b = k.lib, m = b.WordArray, l = b.Hasher, d = [], b = k.algo.SHA1 = l.extend({ _doReset: function () { this._hash = new m.init([1732584193, 4023233417, 2562383102, 271733878, 3285377520]) }, _doProcessBlock: function (n, p) { for (var a = this._hash.words, e = a[0], f = a[1], h = a[2], j = a[3], b = a[4], c = 0; 80 > c; c++) { if (16 > c) d[c] = n[p + c] | 0; else { var g = d[c - 3] ^ d[c - 8] ^ d[c - 14] ^ d[c - 16]; d[c] = g << 1 | g >>> 31 } g = (e << 5 | e >>> 27) + b + d[c]; g = 20 > c ? g + ((f & h | ~f & j) + 1518500249) : 40 > c ? g + ((f ^ h ^ j) + 1859775393) : 60 > c ? g + ((f & h | f & j | h & j) - 1894007588) : g + ((f ^ h ^ j) - 899497514); b = j; j = h; h = f << 30 | f >>> 2; f = e; e = g } a[0] = a[0] + e | 0; a[1] = a[1] + f | 0; a[2] = a[2] + h | 0; a[3] = a[3] + j | 0; a[4] = a[4] + b | 0 }, _doFinalize: function () { var b = this._data, d = b.words, a = 8 * this._nDataBytes, e = 8 * b.sigBytes; d[e >>> 5] |= 128 << 24 - e % 32; d[(e + 64 >>> 9 << 4) + 14] = Math.floor(a / 4294967296); d[(e + 64 >>> 9 << 4) + 15] = a; b.sigBytes = 4 * d.length; this._process(); return this._hash }, clone: function () { var b = l.clone.call(this); b._hash = this._hash.clone(); return b } }); k.SHA1 = l._createHelper(b); k.HmacSHA1 = l._createHmacHelper(b) })();
  (function (k) { for (var g = CryptoJS, h = g.lib, v = h.WordArray, j = h.Hasher, h = g.algo, s = [], t = [], u = function (q) { return 4294967296 * (q - (q | 0)) | 0 }, l = 2, b = 0; 64 > b;) { var d; a: { d = l; for (var w = k.sqrt(d), r = 2; r <= w; r++) if (!(d % r)) { d = !1; break a } d = !0 } d && (8 > b && (s[b] = u(k.pow(l, 0.5))), t[b] = u(k.pow(l, 1 / 3)), b++); l++ } var n = [], h = h.SHA256 = j.extend({ _doReset: function () { this._hash = new v.init(s.slice(0)) }, _doProcessBlock: function (q, h) { for (var a = this._hash.words, c = a[0], d = a[1], b = a[2], k = a[3], f = a[4], g = a[5], j = a[6], l = a[7], e = 0; 64 > e; e++) { if (16 > e) n[e] = q[h + e] | 0; else { var m = n[e - 15], p = n[e - 2]; n[e] = ((m << 25 | m >>> 7) ^ (m << 14 | m >>> 18) ^ m >>> 3) + n[e - 7] + ((p << 15 | p >>> 17) ^ (p << 13 | p >>> 19) ^ p >>> 10) + n[e - 16] } m = l + ((f << 26 | f >>> 6) ^ (f << 21 | f >>> 11) ^ (f << 7 | f >>> 25)) + (f & g ^ ~f & j) + t[e] + n[e]; p = ((c << 30 | c >>> 2) ^ (c << 19 | c >>> 13) ^ (c << 10 | c >>> 22)) + (c & d ^ c & b ^ d & b); l = j; j = g; g = f; f = k + m | 0; k = b; b = d; d = c; c = m + p | 0 } a[0] = a[0] + c | 0; a[1] = a[1] + d | 0; a[2] = a[2] + b | 0; a[3] = a[3] + k | 0; a[4] = a[4] + f | 0; a[5] = a[5] + g | 0; a[6] = a[6] + j | 0; a[7] = a[7] + l | 0 }, _doFinalize: function () { var d = this._data, b = d.words, a = 8 * this._nDataBytes, c = 8 * d.sigBytes; b[c >>> 5] |= 128 << 24 - c % 32; b[(c + 64 >>> 9 << 4) + 14] = k.floor(a / 4294967296); b[(c + 64 >>> 9 << 4) + 15] = a; d.sigBytes = 4 * b.length; this._process(); return this._hash }, clone: function () { var b = j.clone.call(this); b._hash = this._hash.clone(); return b } }); g.SHA256 = j._createHelper(h); g.HmacSHA256 = j._createHmacHelper(h) })(Math);
  (function(){var c=CryptoJS,k=c.enc.Utf8;c.algo.HMAC=c.lib.Base.extend({init:function(a,b){a=this._hasher=new a.init;"string"==typeof b&&(b=k.parse(b));var c=a.blockSize,e=4*c;b.sigBytes>e&&(b=a.finalize(b));b.clamp();for(var f=this._oKey=b.clone(),g=this._iKey=b.clone(),h=f.words,j=g.words,d=0;d<c;d++)h[d]^=1549556828,j[d]^=909522486;f.sigBytes=g.sigBytes=e;this.reset()},reset:function(){var a=this._hasher;a.reset();a.update(this._iKey)},update:function(a){this._hasher.update(a);return this},finalize:function(a){var b=this._hasher;a=b.finalize(a);b.reset();return b.finalize(this._oKey.clone().concat(a))}})})();
  (function(){var h=CryptoJS,j=h.lib.WordArray;h.enc.Base64={stringify:function(b){var e=b.words,f=b.sigBytes,c=this._map;b.clamp();b=[];for(var a=0;a<f;a+=3)for(var d=(e[a>>>2]>>>24-8*(a%4)&255)<<16|(e[a+1>>>2]>>>24-8*((a+1)%4)&255)<<8|e[a+2>>>2]>>>24-8*((a+2)%4)&255,g=0;4>g&&a+0.75*g<f;g++)b.push(c.charAt(d>>>6*(3-g)&63));if(e=c.charAt(64))for(;b.length%4;)b.push(e);return b.join("")},parse:function(b){var e=b.length,f=this._map,c=f.charAt(64);c&&(c=b.indexOf(c),-1!=c&&(e=c));for(var c=[],a=0,d=0;d<e;d++)if(d%4){var g=f.indexOf(b.charAt(d-1))<<2*(d%4),h=f.indexOf(b.charAt(d))>>>6-2*(d%4);c[a>>>2]|=(g|h)<<24-8*(a%4);a++}return j.create(c,a)},_map:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="}})();

  /**
  *
  *  Base64 encode / decode
  *  http://www.webtoolkit.info/
  *
  **/
  var Base64 = {
    // private property
    _keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",

    // public method for encoding
    encode : function (input) {
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;

        input = Base64._utf8_encode(input);

        while (i < input.length) {

            chr1 = input.charCodeAt(i++);
            chr2 = input.charCodeAt(i++);
            chr3 = input.charCodeAt(i++);

            enc1 = chr1 >> 2;
            enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            enc4 = chr3 & 63;

            if (isNaN(chr2)) {
                enc3 = enc4 = 64;
            } else if (isNaN(chr3)) {
                enc4 = 64;
            }

            output = output +
            this._keyStr.charAt(enc1) + this._keyStr.charAt(enc2) +
            this._keyStr.charAt(enc3) + this._keyStr.charAt(enc4);

        }

        return output;
    },

    // private method for UTF-8 encoding
    _utf8_encode : function (string) {
        string = string.replace(/\r\n/g,"\n");
        var utftext = "";

        for (var n = 0; n < string.length; n++) {

            var c = string.charCodeAt(n);

            if (c < 128) {
                utftext += String.fromCharCode(c);
            }
            else if((c > 127) && (c < 2048)) {
                utftext += String.fromCharCode((c >> 6) | 192);
                utftext += String.fromCharCode((c & 63) | 128);
            }
            else {
                utftext += String.fromCharCode((c >> 12) | 224);
                utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                utftext += String.fromCharCode((c & 63) | 128);
            }

        }

        return utftext;
    }

  }
})()
