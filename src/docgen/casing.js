// src/docgen/casing.js
//
// Casing helpers for the engine's snake_case SQL surface.
//
// toSnake is a faithful JS port of any-sdk pkg/casing ToSnake, which itself is
// a verbatim port of botocore's xform_name (separator '_'). The transform is
// intentionally lossy for acronyms (VPCId -> vpc_id) and treats any name that
// already contains '_' as final. Fidelity to any-sdk beats prettiness - do not
// "improve" the awkward cases (IPv6Address -> i_pv_6_address, ARNs -> _arns).

const firstCapRe = /(.)([A-Z][a-z]+)/g;
const numberCapRe = /([a-z])([0-9]+)/g;
const endCapRe = /([a-z0-9])([A-Z])/g;
const specialRe = /[A-Z]{2,}s$/;

const snakeCache = new Map();

/**
 * Convert a wire identifier (camelCase / PascalCase) to snake_case using the
 * botocore xform_name algorithm. Memoised.
 * @param {string} name
 * @returns {string}
 */
export function toSnake(name) {
    if (typeof name !== 'string') return name;
    const cached = snakeCache.get(name);
    if (cached !== undefined) return cached;
    const out = xform(name, '_');
    snakeCache.set(name, out);
    return out;
}

function xform(name, sep) {
    // If the separator is already present, botocore treats the name as final.
    if (name.includes(sep)) {
        return name;
    }
    const special = specialRe.exec(name);
    if (special) {
        // e.g. "DBInstanceARNs" -> "DBInstance" + sep + "arns" before the generic passes.
        name = name.slice(0, special.index) + sep + special[0].toLowerCase();
    }
    const s1 = name.replace(firstCapRe, '$1' + sep + '$2');
    const s2 = s1.replace(numberCapRe, '$1' + sep + '$2');
    const s3 = s2.replace(endCapRe, '$1' + sep + '$2');
    return s3.toLowerCase();
}

/**
 * Symbol used to carry the original wire name on a renamed field / parameter
 * details object. Symbol keys are invisible to Object.entries / JSON.stringify,
 * so attaching it never changes rendered output unless a renderer opts in.
 */
export const WIRE_NAME = Symbol('stackql.wireName');

/**
 * Symbol marking a parameter details object as a server variable. Server
 * variables are authored by the provider and are never aliased.
 */
export const IS_SERVER_VAR = Symbol('stackql.isServerVar');

/**
 * Build a wire-name -> alias map for a set of top-level names, applying the
 * engine's collision rule: a snake alias never clobbers a real name of the
 * same spelling. Names whose snake spelling already exists in `names` (or in
 * `reserved`) keep their wire name.
 * @param {string[]} names - the names to alias
 * @param {Iterable<string>} [reserved] - additional real names that must not be clobbered
 * @returns {Map<string,string>} wire -> display name (identity when not aliased)
 */
export function buildAliasMap(names, reserved = []) {
    const taken = new Set([...names, ...reserved]);
    const map = new Map();
    for (const name of names) {
        const alias = toSnake(name);
        if (alias === name || taken.has(alias)) {
            // identity, or collision with a real name - keep wire spelling
            map.set(name, name);
        } else {
            map.set(name, alias);
        }
    }
    return map;
}

/**
 * Return a new object whose TOP-LEVEL keys are the snake aliases of `obj`'s
 * keys (collision rule applied). Renamed values are shallow-copied so that the
 * WIRE_NAME marker can be attached without mutating shared schema objects.
 * Nested contents are left untouched (wire casing).
 * @param {Object} obj - name -> details
 * @param {Object} [opts]
 * @param {Iterable<string>} [opts.reserved] - extra names that must not be clobbered
 * @param {(details:any)=>boolean} [opts.skip] - entries for which this returns true keep their key
 * @returns {Object}
 */
export function aliasTopLevelKeys(obj, opts = {}) {
    if (!obj || typeof obj !== 'object') return obj;
    const { reserved = [], skip = null } = opts;
    const names = Object.keys(obj);
    const skipped = new Set(skip ? names.filter(n => skip(obj[n])) : []);
    const candidates = names.filter(n => !skipped.has(n));
    const aliasMap = buildAliasMap(candidates, [...reserved, ...skipped]);
    const out = {};
    for (const name of names) {
        const details = obj[name];
        const display = aliasMap.has(name) ? aliasMap.get(name) : name;
        if (display !== name && details && typeof details === 'object' && !Array.isArray(details)) {
            const copy = { ...details };
            copy[WIRE_NAME] = name;
            out[display] = copy;
        } else {
            out[display] = details;
        }
    }
    return out;
}

/**
 * Alias the TOP-LEVEL property names of a request body schema (and the
 * matching entries of its `required` list). Nested schemas keep wire casing.
 * Returns the input unchanged when it carries no `properties` object.
 * @param {Object} requestBody
 * @returns {Object}
 */
export function aliasRequestBody(requestBody) {
    if (!requestBody || typeof requestBody !== 'object' ||
        !requestBody.properties || typeof requestBody.properties !== 'object') {
        return requestBody;
    }
    const properties = aliasTopLevelKeys(requestBody.properties);
    const wireToAlias = new Map();
    for (const [alias, details] of Object.entries(properties)) {
        if (details && details[WIRE_NAME]) {
            wireToAlias.set(details[WIRE_NAME], alias);
        }
    }
    const out = { ...requestBody, properties };
    if (Array.isArray(requestBody.required)) {
        out.required = requestBody.required.map(name => wireToAlias.get(name) ?? name);
    }
    return out;
}

/**
 * Render the optional "(wire: <name>)" hint for a renamed field / parameter.
 * Returns '' when the details object carries no WIRE_NAME marker.
 * @param {Object} details
 * @returns {string}
 */
export function wireHint(details) {
    const wire = details && details[WIRE_NAME];
    return wire ? ` (wire: ${wire})` : '';
}

/**
 * Normalise the `snakeCaseAliases` docgen option into per-surface flags.
 *
 * The engine exposes three independent surfaces, and a provider can be correct
 * on some and not others at a given point in time:
 *
 *   fields  response columns   - snake only when the provider document sets
 *                                `config.snake_case_aliases`
 *   params  WHERE / INSERT column-list inputs - snake when the method declares
 *                                `request.nativeCasing`
 *   body    top-level `data__` request-body properties - snake when the method
 *                                declares `request.nativeCasing` AND the engine
 *                                translates body keys
 *
 * Documenting a surface the provider does not serve produces copy-paste
 * examples that fail, so the three are separately switchable. Accepts:
 *
 *   false | undefined              all off (default)
 *   true                           all on (back-compatible with the boolean form)
 *   { fields, params, body }       per surface; omitted keys default to false
 *
 * @param {boolean|Object} [option]
 * @returns {{fields: boolean, params: boolean, body: boolean}}
 */
export function resolveSnakeCaseAliases(option) {
    if (option === true) {
        return { fields: true, params: true, body: true };
    }
    if (!option || typeof option !== 'object') {
        return { fields: false, params: false, body: false };
    }
    return {
        fields: !!option.fields,
        params: !!option.params,
        body: !!option.body,
    };
}
