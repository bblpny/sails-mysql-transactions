var FN = 'function',

    util = require('./util'),
    db = require('./db'),

    redeffer, // fn
    Multiplexer; // constructor

/**
 * Internal function that allows to use promises model on model functions
 *
 * @param  {Deffer} defer
 * @param  {Multiplexer} multiplexer
 */
redeffer = function (defer, multiplexer) {
    defer.exec = function (cb) {
        multiplexer._connect(function (error, threadId) {
            if (error) { return cb(error); }

            defer.constructor.prototype.exec.call(defer, function (err, result) {
                multiplexer._disconnect(threadId);
                cb && cb(err, util.wrapquery(result, threadId));
            }, threadId);
        });
    };

    return defer;
};

/**
 * Allows one to route different ORM operations to specific database pools.
 * @constructor
 *
 * @param {Waterline.Model} model
 *
 * @throws {Error} If sourceName does not refer to any pool iitialised during ORM setup from `replica` config.
 */
Multiplexer = function (model) {
    this._model = model;
};

util.extend(Multiplexer, {
    /**
     * Stores all the pools of sources defined in replica set configuration.
     * @private
     *
     * @type {object}
     */
    source: db.oneDumbSource,
    /**
     * Stores all connections based on its universal thread id (source + threadId).
     * @private
     *
     * @type {object}
     */
    connections: {},

    /**
     * Creates ORM setup sequencing for all replica set pools.
     * @param  {object} config
     */
    setup: function (config) {
        if (!(config && config.replication && config.replication.sources)) { return; }

        // in case sources exist (almost unlikely, end them)
        this.source && this.source.end();

        // create connections for read-replicas and add it to the peering list
        this.source = db.createCluster(config.replication, config);
    },

    /**
     * ORM teardown sequencing for all replica set pools
     */
    teardown: function () {
        // release all pending connections
        util.each(this.connections, function (connection, threadId, connections) {
            try {
                connection.release();
            }
            catch (e) { } // nothing to do with error
            delete connections[threadId];
        });

        // execute end on the db. will end pool if pool, or otherwise will execute whatever `end` that has been
        // exposed by db.js
        try {
            this.source && this.source.end();
        }
        catch (e) { } // nothing to do with error
    },

    /**
     * Returns the corresponding connection associated with a universal thread id.
     *
     * @param  {string} id
     * @returns {mysql.Connection}
     */
    retrieveConnection: function (id) {
        return this.connections[id];
    }
});

util.extend(Multiplexer.prototype, {
    /**
     * Retrieves a new connection for initialising queries from the pool specified as parameter.
     *
     * @param  {function} callback receives `error`, `threadId`, `connection` as parameter
     */
    _connect: function (callback) {
        var self = this;

        Multiplexer.source.getConnection(function (error, connection) {
            if (error) { return callback(error); }

            // give a unique id to the connection and store it if not already
            self._threadId = util.uid();
            Multiplexer.connections[self._threadId] = connection;

            callback(null, self._threadId, connection);
        });
    },

    /**
     * Release the connection associated with this multiplexer
     * @param {string} threadId
     */
    _disconnect: function (threadId) {
        Multiplexer.connections[threadId] && Multiplexer.connections[threadId].release();
        delete Multiplexer.connections[threadId];
    },

    /**
     * Wraps a result with specific thread id for being utilised later as a input to multiplexer instances.
     * @param  {*} query
     * @returns {*} returns the original `query` parameter
     */
    wrap: function (query) {
        return this._threadId && util.wrapquery(query, this._threadId) || query;
    },

    /**
     * @param  {object} critera
     * @param  {function} callback
     */
    findOne: function (criteria, callback) {
        var self = this;

        if (typeof callback !== FN) {
            return redeffer(self._model.findOne(criteria), self);
        }

        self._connect(function (error, threadId) {
            if (error) { return callback(error); }

            // call function of underlying model
            self._model.findOne(criteria, function (err, result) {
                self._disconnect(threadId);
                callback(err, util.wrapquery(result, threadId));
            }, threadId);
        });
    },

    /**
     * @param  {object} criteria
     * @param  {object=} [options] - parameter is optional and can be removed to shift as callback
     * @param  {function} callback
     */
    find: function (criteria, options, callback) {
        var self = this;

        // find accepts polymorhic arguments. anything function is treated as callback. we too need to do this check
        // here (even while this is done in model.find) so that we test the correct callback parameter while choosing
        // the defer or non-defer path.
        if (typeof criteria === FN) {
            callback = criteria;
            criteria = options = null;
        }

        if (typeof options === FN) {
            callback = options;
            options = null;
        }

        if (typeof callback !== FN) {
            return redeffer(self._model.find(criteria, options), self);
        }

        self._connect(function (error, threadId) {
            if (error) { return callback(error); }

            self._model.find(criteria, options, function (err, result) {
                self._disconnect(threadId);
                callback(err, util.wrapquery(result, threadId));
            }, threadId);
        });
    }
});

module.exports = Multiplexer;