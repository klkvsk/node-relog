var fs      = require('fs');
var http    = require('http');
var mongodb = require('mongodb');
var buffer  = require('buffer');

var config;
try {
    /**
     * to customize settings, put them in config.js. Example (with default values):
     *  exports.port = 1095;
     *  exports.mongo_host = '127.0.0.1';
     *  exports.mongo_port = 27017;
     *  exports.mongo_db = 'relog';
     *  exports.mongo_user = null;
     *  exports.mongo_pass = null;
     *  exports.http_auth = null; // set to "user:pass" for http basic auth
     */
    config = require('./config.js');

} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') { throw e; }
    config = {};
}


var dao = null;

var Response = {
    badRequest: function (response) {
        response.writeHead(400);
        response.end('bad request');
    },
    notFound: function (response) {
        response.writeHead(404);
        response.end('not found');
    },
    internalError: function (response) {
        response.writeHead(500);
        response.end('infernal error');
    },
    data: function (response, data, contentType, encoding, noCache) {
        var headers = {
            'Content-Type': contentType || 'text/plain'
        };
        if (noCache) {
            headers. Expires = (new Date('1970-01-01')).toUTCString();
            headers['Cache-Control'] = 'no-store';
        }
        response.writeHead(200, headers);
        response.end(data, encoding);
    },
    file: function (response, filename, vars) {
        var contentType = 'text/plain';
        var encoding = 'utf8';
        var ext = filename.match(/\.([a-z]+)$/i);
        if (ext) {
            switch (ext[1]) {
                case 'js':   contentType = 'text/javascript'; break;
                case 'html': contentType = 'text/html'; break;
                case 'ico':  contentType = 'image/x-icon'; encoding = 'binary'; break;
            }
        }
        var data = fs.readFileSync(filename, encoding);
        if (typeof vars === 'object') {
            var key;
            for (key in vars) {
                if (vars.hasOwnProperty(key)) {
                    data = data.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'gi'), vars[key]);
                }
            }
        }
        this.data(response, data, contentType, encoding);
    },
    json: function (response, object) {
        this.data(response, JSON.stringify(object), 'application/json', 'utf-8', true);
    }
};

function connectToMongo(callback) {
    var server = new mongodb.Server(config.mongo_host || '127.0.0.1', config.mongo_port || 27017);
    var db = new mongodb.Db('admin', server, {safe: false});
    db.open(function (err) {
        if (err) { throw err; }
        var ready = function (err) {
            if (err) { throw err; }
            dao = db.db('relog').collection('items');
            dao.ensureIndex({path: 1, type: 1, code: 1}, { background: true });
            dao.ensureIndex({path: 1, text: 1},  { background: true });
            dao.ensureIndex({path: 1, host: 1},  { background: true });
            dao.ensureIndex({path: 1, tags: 1},  { background: true });
            dao.ensureIndex({path: 1, date: -1}, { background: true });
            if (callback) { callback(); }
        };

        if (config.mongo_user && config.mongo_pass) {
            db.authenticate(config.mongo_user, config.mongo_pass, ready);
        } else {
            ready(null);
        }
    });
}

function parseDate(dateAsString) {
    var dateAsInt = parseInt(dateAsString, 10);
    var date;
    if (dateAsInt.toString() === date) {
        date = new Date(dateAsInt);
    } else {
        date = new Date(dateAsString);
    }
    if (date.toString() === 'Invalid Date') {
        return null;
    }
    return date;
}

/**
 * @param {Readable|EventEmitter|IncomingMessage} request
 * @param {ServerResponse} response
 */
function requestListener(request, response) {
    /** @type Url */
    var url = require('url').parse(request.url, true);
    var path = url.pathname.split('/')[1];

    if (config.http_auth) {
        var authorized = false;
        if ('authorization' in request.headers) {
            var credentials = request.headers.authorization.match(/^basic (.+)$/i);
            if (credentials) {
                var auth = (new Buffer(credentials[1], 'base64')).toString('ascii');
                if (auth === config.http_auth) {
                    authorized = true;
                }
            }
        }
        if (!authorized) {
            response.writeHead(401, {'WWW-Authenticate': 'Basic realm="ReLog"'});
            response.end('not authorized');
            return;
        }
    }

    switch (request.method.toUpperCase()) {
        case 'GET':
            if ('x-requested-with' in request.headers && request.headers['x-requested-with'] === 'XMLHttpRequest') {
                // ajax
                var perPage = 1000;
                var criteria = { path: path };
                if (url.query.type) {
                    criteria.type = {$regex: url.query.type, $options: 'i'};
                }
                if (url.query.code) {
                    criteria.code = url.query.code;
                }
                if (url.query.host) {
                    criteria.host = {$regex: url.query.host, $options: 'i'};
                }
                if (url.query.tags) {
                    var tags = url.query.tags.split(/\s*,\s*/g).filter(function(t) { return t !== ''; });
                    if (tags.length > 0) {
                        criteria.tags = {$in: tags};
                    }
                }
                var from, till;
                if (url.query.from) { from = parseDate(url.query.from); }
                if (url.query.till) { till = parseDate(url.query.till); }
                if (from || till) {
                    criteria.date = {};
                    if (from) { criteria.date.$gte = from; }
                    if (till) { criteria.date.$lte = till; }
                }
                var skip = (parseInt(url.query.skip, 10) || 0) * perPage;
                console.log(criteria);
                dao.find(criteria).skip(skip).limit(perPage).sort('_id', 'desc', function(err, cursor) {
                    if (err) {
                        Response.internalError(response);
                        console.error(err);
                    } else {
                        cursor.toArray(function(err, data) {
                            if (err) {
                                Response.internalError(response);
                                console.error(err);
                            } else {
                                Response.json(response, data);
                            }
                        });
                    }
                });
            } else {
                // not ajax
                switch (url.path) {
                    case '/favicon.ico':
                    case '/jquery.js':
                        Response.file(response, 'www' + url.path);
                        break;

                    default:
                        Response.file(response, 'www/index.html');
                        break;
                }
            }
            break;

        case 'POST':
            var post = '';
            request.setEncoding('utf8');
            request.on('data', function (chunk) {
                post += chunk.toString();
            });
            request.on('end', function () {
                try {
                    var date;
                    if (url.query.date) {
                        date = parseDate(url.query.date);
                    }
                    var log = {
                        path: path,
                        date: date || (new Date()),
                        host: url.query.host || request.socket.remoteAddress,
                        type: url.query.type,
                        code: url.query.code,
                        text: url.query.text,
                        tags: (url.query.tags || '').split(/\s*,\s*/).filter(function (x) { return x !== ''; }),
                        more: post
                    };

                    console.log(log);
                    if (!log.type || !log.path || (!log.code && !log.text)) {
                        Response.badRequest(response);
                    } else {
                        dao.insert(log);
                        Response.data(response, 'ok');
                    }

                } catch (e) {
                    console.log(e);
                    Response.internalError(response);
                }
            });
            break;

        default:
            Response.badRequest(response);
            break;
    }
}

/** @type Server */
var httpServer = http.createServer(requestListener);
connectToMongo(function () {
    httpServer.listen(config.port || 1095, function () {
        console.log('ReLog started');
    });
});
