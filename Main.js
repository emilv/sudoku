/* Eval
   Evaluate the given thunk t into head normal form.
   If the "thunk" we get isn't actually a thunk, just return it.
*/
function E(t) {
    if(t instanceof Thunk) {
        if(t.f) {
            t.x = t.f();
            t.f = 0;
        }
        return t.x;
    }
    return t;
}

/* Thunk
   Creates a thunk representing the given closure.
   Since we want automatic memoization of as many expressions as possible, we
   use a JS object as a sort of tagged pointer, where the member x denotes the
   object actually pointed to. If a "pointer" points to a thunk, it has a
   member 't' which is set to true; if it points to a value, be it a function,
   a value of an algebraic type of a primitive value, it has no member 't'.

   When a thunk is evaluated, by reading the member 'x' of the "pointer," the
   closure is evaluated and the getter removed, to be replaced with the value
   returned by the thunk, and the getter finally returns the return value of
   the closure.
*/

function T(f) {
    return new Thunk(f);
}

function Thunk(f) {
    this.f = f;
}

/* Integer literal
   Generates an Integer literal from a Number.
   This might be dependent on using integer-simple for Integers.
*/
function I(n) {
    if(n > 0) {
        return [1,[1, n, 2]];
    } else if(n < 0) {
        return [2,[1,n,2]];
    } else {
        return [3]
    }
}

/* Apply
   Applies the function f to the arguments args. If the application is under-
   saturated, a closure is returned, awaiting further arguments. If it is over-
   saturated, the function is fully applied, and the result (assumed to be a
   function) is then applied to the remaining arguments.
*/
function A(f, args) {
    f = f instanceof Thunk ? E(f) : f;
    // Closure does some funny stuff with functions that occasionally
    // results in non-functions getting applied, so we have to deal with
    // it.
    if(!f.apply) {
        return f;
    }

    var arity = f.arity ? f.arity : f.length;
    if(args.length === arity) {
        return f.apply(null, args);
    }
    if(args.length > arity) {
        var first = args.splice(0, arity);
        return A(f.apply(null, first), args);
    } else {
        var g = function() {
            var as = args.concat(Array.prototype.slice.call(arguments));
            return A(f, as);
        };
        g.arity = arity - args.length;
        return g;
    }
}

/* Throw an error.
   We need to be able to use throw as an exception so we wrap it in a function.
*/
function die(err) {
    throw err;
}

function quot(a, b) {
    return (a-a%b)/b;
}

// 32 bit integer multiplication, with correct overflow behavior
// note that |0 or >>>0 needs to be applied to the result, for int and word
// respectively.
function imul(a, b) {
  // ignore high a * high a as the result will always be truncated
  var lows = (a & 0xffff) * (b & 0xffff); // low a * low b
  var aB = (a & 0xffff) * (b & 0xffff0000); // low a * high b
  var bA = (a & 0xffff0000) * (b & 0xffff); // low b * high a
  return lows + aB + bA; // sum will not exceed 52 bits, so it's safe
}

function addC(a, b) {
    var x = a+b;
    return [1, x & 0xffffffff, x > 0x7fffffff];
}

function subC(a, b) {
    var x = a-b;
    return [1, x & 0xffffffff, x < -2147483648];
}

function sinh (arg) {
    return (Math.exp(arg) - Math.exp(-arg)) / 2;
}

function tanh (arg) {
    return (Math.exp(arg) - Math.exp(-arg)) / (Math.exp(arg) + Math.exp(-arg));
}

function cosh (arg) {
    return (Math.exp(arg) + Math.exp(-arg)) / 2;
}

function log2(x) {
    var high = 1024;
    var low = -1024;
    var i = 0;
    var x2;
    for(;;) {
        x2 = Math.pow(2, i);
        if(x2 <= (x >> 1)) {
            low = i;
            i += (high - i) >> 1;
        } else if(x2 > x) {
            high = i;
            i += (low - i) >> 1;
        } else {
            return i;
        }
    }
    return i;
}

function decodeFloat(x) {
    if(isNaN(x)) {
        return [1, -6755399441055744, 972];
    }
    var sig = x > 0 ? 1 : -1;
    if(!isFinite(x)) {
        return [1, sig * 4503599627370496, 972];
    }
    x = Math.abs(x);
    var exp = log2(x)-52;
    var man = x/Math.pow(2, exp);
    return [1, sig*man, exp];
}

function decodeDouble(x) {
    var decoded = decodeFloat(x);
    var sign = decoded[1] < 0 ? -1 : 1;
    var mantissa = decoded[1]*sign;
    var manLow = mantissa % 0x100000000;
    var manHigh = Math.floor(mantissa / 0x100000000);
    return [1, sign, manHigh, manLow, decoded[2]];
}

function newArr(n, x) {
    var arr = [];
    for(; n >= 0; --n) {
        arr.push(x);
    }
    // Use 0 for the never-examined state argument.
    return [1, 0, arr];
}

function newByteArr(n, x) {
    var arr = new Int8Array(n);
    return [1, 0, arr];
}

function err(str) {
    die(toJSStr(str)[1]);
}

/* unpackCString#
   NOTE: update constructor tags if the code generator starts munging them.
*/
function unCStr(str) {
    return unAppCStr(str, [1]);
}

function unAppCStr(str, chrs) {
    var i = arguments[2] ? arguments[2] : 0;
    if(i >= str.length) {
        return E(chrs);
    } else {
        return [2,[1,str.charAt(i)],T(function() {
            return unAppCStr(str,chrs,i+1);
        })];
    }
}

function fromJSStr(str) {
    return unCStr(E(str)[1]);
}

function toJSStr(str) {
    str = E(str);
    var s = '';
    while(str[0] == 2) {
        var cs = readHSUnicodeChar(str);
        s += cs[0];
        str = cs[1];
    }
    return [1,s];
}

function readHSUnicodeChar(str) {
    var c = E(str[1])[1];
    // If we get slashes, read all numbers we encounter.
    if(c == '\\') {
        var num = '';
        str = E(str[2]);
        if(str == 1) {
            return ['\\', str];
        }
        c = E(str[1])[1];
        while(c >= '0' && c <= '9') {
            num += c;
            str = E(str[2]);
            c = E(str[1])[1];
        }
        if(num.length == 0) {
            return ['\\', str];
        }
        c = String.fromCharCode(Number(num));
        return [c, str];
    } else {
        return [c, E(str[2])];
    }
}

// newMutVar
function nMV(val, st) {
    return [1,st,{x: val}];
}

// readMutVar
function rMV(mv, st) {
    return [1,st,mv.x];
}

// writeMutVar
function wMV(mv, val, st) {
    mv.x = val;
    return [1,st];
}

function localeEncoding(theWorld) {
    return [1,theWorld,'UTF-8'];
}

// every newSomethingSomethingByteArray
function newBA(size, theWorld) {
    var s = '';
    while(size >= 0) {
        s += '';
        --size;
    }
    return [1,theWorld,s];
}

function wOffAddr(addr, off, val, theWorld) {
    addr[off] = val;
    return theWorld;
}

function isDoubleNaN(d,_) {
    return [1,0,isNaN(d)];
}
var isFloatNaN = isDoubleNaN;

function isDoubleInfinite(d,_) {
    return [1,0,d === Infinity];
}
var isFloatInfinite = isDoubleInfinite;

function isDoubleNegativeZero(x,_) {
    return [1,0,x===0 && (1/x)===-Infinity];
}
var isFloatNegativeZero = isDoubleNegativeZero;

function strEq(a, b, _) {
    return [1, 0, a == b];
}

function strOrd(a, b, _) {
    var ord;
    if(a < b) {
        ord = [1];
    } else if(a == b) {
        ord = [2];
    } else {
        ord = [3];
    }
    return [1, 0, [1, ord]];
}

function jsCatch(act, handler, _) {
    try {
        return [1,0,A(act,[0])[2]];
    } catch(e) {
        return [1,0,A(handler,[e,0])[2]];
    }
}

function hs_eqWord64(a, b, _) {
    return [1,0,a==b];
}

var realWorld = 0;
var coercionToken = undefined;

/* Haste represents constructors internally using 1 for the first constructor,
   2 for the second, etc.
   However, dataToTag should use 0, 1, 2, etc. Also, booleans might be unboxed.
 */
function dataToTag(x) {
    if(x instanceof Array) {
        return x[0]-1;
    } else {
        return x-1;
    }
}

function __word_encodeDouble(d, e, _) {
    return [1,0, d * Math.pow(2,e)];
}

function jsAlert(val,_) {
    if(typeof alert != 'undefined') {
        alert(val);
    } else {
        print(val);
    }
    return [1,0];
}

function jsLog(val,_) {
    console.log(val);
    return [1,0];
}

function jsPrompt(str,_) {
    var val;
    if(typeof prompt != 'undefined') {
        val = prompt(str);
    } else {
        print(str);
        val = readline();
    }
    return [1,0,val == undefined ? '' : val.toString()];
}

function jsEval(str,_) {
    var x = eval(str);
    return [1,0,x == undefined ? '' : x.toString()];
}

function isNull(obj,_) {
    return [1,0,[obj === null]];
}

function jsRead(str,_) {
    return [1,0,Number(str)];
}

function jsShowI(val, _) {return [1,0,val.toString()];}
function jsShow(val, _) {
    var ret = val.toString();
    return [1,0,val == Math.round(val) ? ret + '.0' : ret];
}

function jsSetCB(elem, evt, cb, _) {
    // Count return press in single line text box as a change event.
    if(evt == 'change' && elem.type.toLowerCase() == 'text') {
        setCB(elem, 'keyup', function(k) {
            if(k == '\n') {
                A(cb,[[1,k.keyCode], 0]);
            }
        });
    }

    var fun;
    switch(evt) {
    case 'click':
    case 'dblclick':
    case 'mouseup':
    case 'mousedown':
        fun = function(x) {A(cb,[[1,x.button], 0]);};
        break;
    case 'keypress':
    case 'keyup':
    case 'keydown':
        fun = function(x) {A(cb,[[1,x.keyCode], 0]);};
        break;        
    default:
        fun = function() {A(cb,[0]);};
        break;
    }
    return setCB(elem, evt, fun);
}

function setCB(elem, evt, cb) {
    if(elem.addEventListener) {
        elem.addEventListener(evt, cb, false);
        return [1,0,true];
    } else if(elem.attachEvent) {
        elem.attachEvent('on'+evt, cb);
        return [1,0,true];
    }
    return [1,0,false];
}

function jsSetTimeout(msecs, cb, _) {
    window.setTimeout(function() {A(cb,[0]);}, msecs);
    return [1,0];
}

// Round a Float/Double.
function rintDouble(d, _) {
    return [1,0,Math.round(d)];
}
var rintFloat = rintDouble;

// Degenerate versions of u_iswspace, u_iswalnum and u_iswalpha.
function u_iswspace(c, _) {
    return [1,0, c==9 || c==10 || c==13 || c==32];
}

function u_iswalnum(c, _) {
    return [1,0, (c >= 48 && c <= 57) || u_iswalpha(c)[0]];
}

// [a-zA-ZåäöÅÄÖ]
function u_iswalpha(c, _) {
    return [1,0, (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
                  c == 229 || c == 228 || c == 246 ||
                  c == 197 || c == 196 || c == 214];
}

function jsGet(elem, prop, _) {
    return [1,0,elem[prop].toString()];
}

function jsSet(elem, prop, val, _) {
    elem[prop] = val;
    return [1,0];
}

function jsGetStyle(elem, prop, _) {
    return [1,0,elem.style[prop].toString()];
}

function jsSetStyle(elem, prop, val, _) {
    elem.style[prop] = val;
    return [1,0];
}

function jsKillChild(child, parent, _) {
    parent.removeChild(child);
    return [1,0];
}

function jsClearChildren(elem, _) {
    while(elem.hasChildNodes()){
        elem.removeChild(elem.lastChild);
    }
    return [1,0];
}

function jsFind(elem, _) {
    var e = document.getElementById(elem)
    if(e) {
        return [1,0,[2,[1,e]]];
    }
    return [1,0,[1]];
}

function jsCreateElem(tag, _) {
    return [1,0,document.createElement(tag)];
}

function jsGetChildBefore(elem, _) {
    elem = elem.previousSibling;
    while(elem) {
        if(typeof elem.tagName != 'undefined') {
            return [1,0,[2,[1,elem]]];
        }
        elem = elem.previousSibling;
    }
    return [1,0,[1]];
}

function jsGetLastChild(elem, _) {
    var len = elem.childNodes.length;
    for(var i = len-1; i >= 0; --i) {
        if(typeof elem.childNodes[i].tagName != 'undefined') {
            return [1,0,[2,[1,elem.childNodes[i]]]];
        }
    }
    return [1,0,[1]];
}

function jsGetChildren(elem, _) {
    var children = [1];
    var len = elem.childNodes.length;
    for(var i = len-1; i >= 0; --i) {
        if(typeof elem.childNodes[i].tagName != 'undefined') {
            children = [2, [1,elem.childNodes[i]], children];
        }
    }
    return [1,0,children];
}

function jsSetChildren(elem, children, _) {
    children = E(children);
    jsClearChildren(elem, 0);
    while(children[0] === 2) {
        elem.appendChild(E(E(children[1])[1]));
        children = E(children[2]);
    }
    return [1,0];
}

function jsAppendChild(child, container, _) {
    container.appendChild(child);
    return [1,0];
}

function jsAddChildBefore(child, container, after, _) {
    container.insertBefore(child, after);
    return [1,0];
}

function jsRand(_) {
    return [1,0,Math.random()];
}

// Concatenate a Haskell list of JS strings
function jsCat(strs, sep, _) {
    var arr = [];
    strs = E(strs);
    while(strs[0] != 1) {
        strs = E(strs);
        arr.push(E(strs[1])[1]);
        strs = E(strs[2]);
    }
    return [1,0,arr.join(sep)];
}

// Escape all double quotes in a string
function jsUnquote(str, _) {
    return [1,0,str.replace(/"/, '\\"')];
}

// Parse a JSON message into a Haste.JSON.JSON value.
// As this pokes around inside Haskell values, it'll need to be updated if:
// * Haste.JSON.JSON changes;
// * E() starts to choke on non-thunks;
// * data constructor code generation changes; or
// * Just and Nothing change tags.
function jsParseJSON(str, _) {
    try {
        var js = JSON.parse(str);
        var hs = toHS(js);
    } catch(_) {
        return [1,0,[1]];
    }
    return [1,0,[2,hs]];
}

function toHS(obj) {
    switch(typeof obj) {
    case 'number':
        return [1, [1, jsRead(obj)[2]]];
    case 'string':
        return [2, [1, obj]];
        break;
    case 'boolean':
        return [3, obj]; // Booleans are special wrt constructor tags!
        break;
    case 'object':
        if(obj instanceof Array) {
            return [4, arr2lst(obj, 0)];
        } else {
            // Object type but not array - it's a dictionary.
            // The RFC doesn't say anything about the ordering of keys, but
            // considering that lots of people rely on keys being "in order" as
            // defined by "the same way someone put them in at the other end,"
            // it's probably a good idea to put some cycles into meeting their
            // misguided expectations.
            var ks = [];
            for(var k in obj) {
                ks.unshift(k);
            }
            var xs = [1];
            for(var i in ks) {
                xs = [2, [1, [1,ks[i]], toHS(obj[ks[i]])], xs];
            }
            return [5, xs];
        }
    }
}

function arr2lst(arr, elem) {
    if(elem >= arr.length) {
        return [1];
    }
    return [2, toHS(arr[elem]), T(function() {return arr2lst(arr,elem+1);})]
}

function ajaxReq(method, url, async, postdata, cb, _) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, async);
    xhr.setRequestHeader('Cache-control', 'no-cache');
    xhr.onreadystatechange = function() {
        if(xhr.readyState == 4) {
            if(xhr.status == 200) {
                A(cb,[[1,xhr.responseText],0]);
            } else {
                A(cb,[[1,""],0]); // Nothing
            }
        }
    }
    xhr.send(postdata);
    return [1,0];
}

function u_towlower(charCode, _) {
    return [1, 0, String.fromCharCode(charCode).toLowerCase().charCodeAt(0)];
}

function u_towupper(charCode, _) {
    return [1, 0, String.fromCharCode(charCode).toUpperCase().charCodeAt(0)];
}

// MVar implementation.
// Since Haste isn't concurrent, takeMVar and putMVar don't block on empty
// and full MVars respectively, but terminate the program since they would
// otherwise be blocking forever.

function newMVar(st) {
    return [1, st, {empty: true}];
}

function tryTakeMVar(mv, st) {
    if(mv.empty) {
        return [1, st, 0, undefined];
    } else {
        mv.empty = true;
        mv.x = null;
        return [1, st, 1, mv.x];
    }
}

function takeMVar(mv, st) {
    if(mv.empty) {
        // TODO: real BlockedOnDeadMVar exception, perhaps?
        err("Attempted to take empty MVar!");
    }
    mv.empty = true;
    mv.x = null;
    return [1,st,mv.x];
}

function putMVar(mv, val, st) {
    if(!mv.empty) {
        // TODO: real BlockedOnDeadMVar exception, perhaps?
        err("Attempted to put full MVar!");
    }
    mv.empty = false;
    mv.x = val;
    return [1,st];
}

function tryPutMVar(mv, val, st) {
    if(!mv.empty) {
        return [1, st, 0];
    } else {
        mv.empty = false;
        mv.x = val;
        return [1, st, 1];
    }
}

function sameMVar(a, b) {
    return (a == b);
}

function isEmptyMVar(mv, st) {
    return [1, st, mv.empty ? 1 : 0];
}

// Implementation of stable names.
// Unlike native GHC, the garbage collector isn't going to move data around
// in a way that we can detect, so each object could serve as its own stable
// name if it weren't for the fact we can't turn a JS reference into an
// integer.
// So instead, each object has a unique integer attached to it, which serves
// as its stable name.

var __next_stable_name = 1;

function makeStableName(x, _world) {
    if(!x.stableName) {
        x.stableName = __next_stable_name;
        __next_stable_name += 1;
    }
    return [1,_world,x.stableName];
}

function eqStableName(x, y) {
    return (x == y) ? 1 : 0;
}

var _0 = T(function(){return unCStr("Maybe.fromJust: Nothing");});var _1 = T(function(){return err(_0);});var _2 = function(_3,_4,_5){var _6 = T(function(){var _7 = A(_3,[_5]);var _8 = _7[1];var _9 = _7[2];var _a = T(function(){var _b = E(_6);if(_b[0]==1){var _c = E(_1);}else{var _d = _b[1];var _c = E(_d);}return _c;});var _e = A(_4,[_a]);var _f = _e[1];var _g = _e[2];var _h = hs_eqWord64(_8,_f,realWorld);var _i = _h[2];var _j = E(_i);if(_j){var _k = hs_eqWord64(_9,_g,realWorld);var _l = _k[2];var _m = E(_l);var _n = _m?[2,_5]:[1];var _o = _n;}else{var _o = [1];}return _o;});return E(_6);};var _p = function(_q){var _r = E(_q);var _s = _r[1];var _t = E(_s);return _t;};var _u = T(function(){return unCStr("base");});var _v = T(function(){return unCStr("GHC.IO.Exception");});var _w = T(function(){return unCStr("IOException");});var _x = [1,7238999624334008320,1.0769272474234763e19,_u,_v,_w];var _y = [1];var _z = [1,7238999624334008320,1.0769272474234763e19,_x,_y];var _A = function(_B){return E(_z);};var _C = function(_D){var _E = E(_D);var _F = _E[1];var _G = _E[2];var _H = _p(_F);var _I = _2(_H,_A,_G);return _I;};var _J = function(_K,_L){var _M = E(_K);if(_M[0]==1){var _N = E(_L);}else{var _O = _M[1];var _P = _M[2];var _Q = T(function(){return _J(_P,_L);});var _N = [2,_O,_Q];}return _N;};var _R = T(function(){return unCStr(": ");});var _S = [1,')'];var _T = T(function(){return unCStr(" (");});var _U = T(function(){return unCStr("already exists");});var _V = T(function(){return unCStr("does not exist");});var _W = T(function(){return unCStr("protocol error");});var _X = T(function(){return unCStr("failed");});var _Y = T(function(){return unCStr("invalid argument");});var _Z = T(function(){return unCStr("inappropriate type");});var _10 = T(function(){return unCStr("hardware fault");});var _11 = T(function(){return unCStr("unsupported operation");});var _12 = T(function(){return unCStr("timeout");});var _13 = T(function(){return unCStr("resource vanished");});var _14 = T(function(){return unCStr("interrupted");});var _15 = T(function(){return unCStr("resource busy");});var _16 = T(function(){return unCStr("resource exhausted");});var _17 = T(function(){return unCStr("end of file");});var _18 = T(function(){return unCStr("illegal operation");});var _19 = T(function(){return unCStr("permission denied");});var _1a = T(function(){return unCStr("user error");});var _1b = T(function(){return unCStr("unsatisified constraints");});var _1c = T(function(){return unCStr("system error");});var _1d = function(_1e,_1f){var _1g = E(_1e);switch(_1g[0]){case 1:var _1h = _J(_U,_1f);break;case 2:var _1h = _J(_V,_1f);break;case 3:var _1h = _J(_15,_1f);break;case 4:var _1h = _J(_16,_1f);break;case 5:var _1h = _J(_17,_1f);break;case 6:var _1h = _J(_18,_1f);break;case 7:var _1h = _J(_19,_1f);break;case 8:var _1h = _J(_1a,_1f);break;case 9:var _1h = _J(_1b,_1f);break;case 10:var _1h = _J(_1c,_1f);break;case 11:var _1h = _J(_W,_1f);break;case 12:var _1h = _J(_X,_1f);break;case 13:var _1h = _J(_Y,_1f);break;case 14:var _1h = _J(_Z,_1f);break;case 15:var _1h = _J(_10,_1f);break;case 16:var _1h = _J(_11,_1f);break;case 17:var _1h = _J(_12,_1f);break;case 18:var _1h = _J(_13,_1f);break;case 19:var _1h = _J(_14,_1f);break;}return _1h;};var _1i = [1,'}'];var _1j = T(function(){return unCStr("{handle: ");});var _1k = function(_1l,_1m,_1n,_1o,_1p,_1q){var _1r = T(function(){var _1s = T(function(){var _1t = T(function(){var _1u = E(_1o);if(_1u[0]==1){var _1v = E(_1q);}else{var _1w = T(function(){var _1x = [2,_S,_1q];return _J(_1u,_1x);});var _1v = _J(_T,_1w);}return _1v;});return _1d(_1m,_1t);});var _1y = E(_1n);if(_1y[0]==1){var _1z = E(_1s);}else{var _1A = T(function(){return _J(_R,_1s);});var _1z = _J(_1y,_1A);}return _1z;});var _1B = E(_1p);if(_1B[0]==1){var _1C = E(_1l);if(_1C[0]==1){var _1D = E(_1r);}else{var _1E = _1C[1];var _1F = E(_1E);if(_1F[0]==1){var _1G = _1F[1];var _1H = T(function(){var _1I = T(function(){return _J(_R,_1r);});var _1J = [2,_1i,_1I];return _J(_1G,_1J);});var _1K = _J(_1j,_1H);}else{var _1L = _1F[1];var _1M = T(function(){var _1N = T(function(){return _J(_R,_1r);});var _1O = [2,_1i,_1N];return _J(_1L,_1O);});var _1K = _J(_1j,_1M);}var _1D = _1K;}var _1P = _1D;}else{var _1Q = _1B[1];var _1R = T(function(){return _J(_R,_1r);});var _1P = _J(_1Q,_1R);}return _1P;};var _1S = function(_1T){var _1U = E(_1T);var _1V = _1U[1];var _1W = _1U[2];var _1X = _1U[3];var _1Y = _1U[4];var _1Z = _1U[6];var _20 = _1k(_1V,_1W,_1X,_1Y,_1Z,_y);return _20;};var _21 = [1,','];var _22 = [1,']'];var _23 = [1,'['];var _24 = function(_25,_26){var _27 = E(_25);if(_27[0]==1){var _28 = unAppCStr("[]",_26);}else{var _29 = _27[1];var _2a = _27[2];var _2b = T(function(){var _2c = E(_29);var _2d = _2c[1];var _2e = _2c[2];var _2f = _2c[3];var _2g = _2c[4];var _2h = _2c[6];var _2i = T(function(){var _2j = [2,_22,_26];var _2k = function(_2l){var _2m = E(_2l);if(_2m[0]==1){var _2n = E(_2j);}else{var _2o = _2m[1];var _2p = _2m[2];var _2q = T(function(){var _2r = E(_2o);var _2s = _2r[1];var _2t = _2r[2];var _2u = _2r[3];var _2v = _2r[4];var _2w = _2r[6];var _2x = T(function(){return _2k(_2p);});var _2y = _1k(_2s,_2t,_2u,_2v,_2w,_2x);return _2y;});var _2n = [2,_21,_2q];}return _2n;};return _2k(_2a);});var _2z = _1k(_2d,_2e,_2f,_2g,_2h,_2i);return _2z;});var _28 = [2,_23,_2b];}return _28;};var _2A = function(_2B,_2C,_2D){var _2E = E(_2C);var _2F = _2E[1];var _2G = _2E[2];var _2H = _2E[3];var _2I = _2E[4];var _2J = _2E[6];var _2K = _1k(_2F,_2G,_2H,_2I,_2J,_2D);return _2K;};var _2L = [1,_2A,_1S,_24];var _2M = T(function(){return [1,_A,_2L,_2N,_C];});var _2N = function(_2O){return [1,_2M,_2O];};var _2P = [1];var _2Q = [8];var _2R = function(_2S){return [1,_2P,_2Q,_y,_2S,_2P,_2P];};var _2T = function(_2U,_2V){var _2W = T(function(){var _2X = T(function(){return _2R(_2U);});return _2N(_2X);});return die(_2W,_2V);};var _2Y = function(_2Z,_30){return _2T(_2Z,_30);};var _31 = T(function(){return unCStr("Prelude.(!!): negative index\n");});var _32 = T(function(){return err(_31);});var _33 = T(function(){return unCStr("Prelude.(!!): index too large\n");});var _34 = T(function(){return err(_33);});var _35 = function(_36,_37){while(1){var _38 = E(_36);if(_38[0]==1){var _39 = E(_34);}else{var _3a = _38[1];var _3b = _38[2];var _3c = E(_37);if(_3c){var _3d = _3c-1|0;_36=_3b;_37=_3d;continue;var _3e = die("Unreachable!");var _3f = _3e;}else{var _3f = E(_3a);}var _39 = _3f;}return _39;}};var _3g = function(_3h){var _3i = E(_3h);switch(_3i[0]){case 1:var _3j = _3i[1];var _3k = E(_3j);if(_3k[0]==1){var _3l = _3k[1];var _3m = E(_3l);}else{var _3m = 0;}var _3n = _3m;break;case 2:var _3o = _3i[1];var _3p = E(_3o);if(_3p[0]==1){var _3q = _3p[1];var _3r = 0-_3q>>>0;}else{var _3r = 0;}var _3n = _3r;break;case 3:var _3n = 0;break;}return _3n;};var _3s = function(_3t){var _3u = _3g(_3t);var _3v = _3u&4294967295;return _3v;};var _3w = function(_3x,_3y){return [3];};var _3z = function(_3A,_3B){return _3w(_3A,_3B);};var _3C = function(_3D){var _3E = E(_3D);switch(_3E[0]){case 1:var _3F = _3E[1];var _3G = [2,E(_3F)];break;case 2:var _3H = _3E[1];var _3G = [1,E(_3H)];break;case 3:var _3G = [3];break;}return _3G;};var _3I = [2];var _3J = function(_3K){var _3L = _3K==0;if(_3L){var _3M = [3];}else{var _3N = [1,E(_3K),E(_3I)];var _3M = [1,E(_3N)];}return _3M;};var _3O = function(_3P){var _3Q = _3P>=0;if(_3Q){var _3R = _3P>>>0;var _3S = _3J(_3R);var _3T = _3S;}else{var _3U = -_3P;var _3V = _3U>>>0;var _3W = _3J(_3V);var _3X = _3C(_3W);var _3T = _3X;}return _3T;};var _3Y = I(0);var _3Z = function(_40,_41){var _42 = E(_40);if(_42[0]==1){var _43 = _42[1];var _44 = _42[2];var _45 = E(_41);if(_45[0]==1){var _46 = _45[1];var _47 = _45[2];var _48 = _3Z(_44,_47);if(_48[0]==2){var _49 = _43<_46;if(_49){var _4a = [1];}else{var _4b = _43>_46;var _4a = _4b?[3]:[2];}var _4c = _4a;}else{var _4c = E(_48);}var _4d = _4c;}else{var _4d = [3];}var _4e = _4d;}else{var _4f = E(_41);var _4e = _4f[0]==1?[1]:[2];}return _4e;};var _4g = [1,E(47),E(_3I)];var _4h = function(_4i,_4j,_4k){var _4l = E(_4i);if(_4l[0]==1){var _4m = _4l[1];var _4n = _4l[2];var _4o = _4m==_4j;if(_4o){var _4p = _4q(_4n,_4k);var _4r = _4p[0]==1?[1,E(0),E(_4p)]:[2];}else{var _4s = _4m>_4j;if(_4s){var _4t = _4q(_4n,_4k);var _4u = _4m-_4j>>>0;var _4v = [1,E(_4u),E(_4t)];var _4w = _4v;}else{var _4x = _4q(_4n,_4k);var _4y = _4h(_4x,1,_3I);var _4z = 4294967295-_4j>>>0;var _4A = _4z+1>>>0;var _4B = _4A+_4m>>>0;var _4C = [1,E(_4B),E(_4y)];var _4w = _4C;}var _4r = _4w;}var _4D = _4r;}else{var _4D = E(_4g);}return _4D;};var _4q = function(_4E,_4F){var _4G = E(_4E);if(_4G[0]==1){var _4H = _4G[1];var _4I = _4G[2];var _4J = E(_4F);if(_4J[0]==1){var _4K = _4J[1];var _4L = _4J[2];var _4M = _4H==_4K;if(_4M){var _4N = _4q(_4I,_4L);var _4O = _4N[0]==1?[1,E(0),E(_4N)]:[2];}else{var _4P = _4H>_4K;if(_4P){var _4Q = _4q(_4I,_4L);var _4R = _4H-_4K>>>0;var _4S = [1,E(_4R),E(_4Q)];var _4T = _4S;}else{var _4U = _4q(_4I,_4L);var _4V = _4h(_4U,1,_3I);var _4W = 4294967295-_4K>>>0;var _4X = _4W+1>>>0;var _4Y = _4X+_4H>>>0;var _4Z = [1,E(_4Y),E(_4V)];var _4T = _4Z;}var _4O = _4T;}var _50 = _4O;}else{var _50 = E(_4G);}var _51 = _50;}else{var _52 = E(_4F);var _51 = _52[0]==1?E(_4g):[2];}return _51;};var _53 = [1,E(1),E(_3I)];var _54 = function(_55){var _56 = E(_55);if(_56[0]==1){var _57 = _56[1];var _58 = _56[2];var _59 = _57==4294967295;if(_59){var _5a = _54(_58);var _5b = [1,E(0),E(_5a)];var _5c = _5b;}else{var _5d = _57+1>>>0;var _5e = [1,E(_5d),E(_58)];var _5c = _5e;}var _5f = _5c;}else{var _5f = E(_53);}return _5f;};var _5g = T(function(){return _54(_3I);});var _5h = function(_5i,_5j,_5k,_5l,_5m){var _5n = _5j<_5l;if(_5n){var _5o = _5h(_5i,_5l,_5m,_5j,_5k);}else{var _5p = _5l>=2147483648;if(_5p){var _5q = _5r(1,_5k,_5m);var _5s = _5l-2147483648>>>0;var _5t = _5j-2147483648>>>0;var _5u = _5t+_5s>>>0;var _5v = _5u+_5i>>>0;var _5w = [1,E(_5v),E(_5q)];var _5x = _5w;}else{var _5y = _5j>=2147483648;if(_5y){var _5z = _5j-2147483648>>>0;var _5A = _5z+_5l>>>0;var _5B = _5A+_5i>>>0;var _5C = _5B<2147483648;if(_5C){var _5D = _5r(0,_5k,_5m);var _5E = _5B+2147483648>>>0;var _5F = [1,E(_5E),E(_5D)];var _5G = _5F;}else{var _5H = _5r(1,_5k,_5m);var _5I = _5B-2147483648>>>0;var _5J = [1,E(_5I),E(_5H)];var _5G = _5J;}var _5K = _5G;}else{var _5L = _5r(0,_5k,_5m);var _5M = _5j+_5l>>>0;var _5N = _5M+_5i>>>0;var _5O = [1,E(_5N),E(_5L)];var _5K = _5O;}var _5x = _5K;}var _5o = _5x;}return _5o;};var _5r = function(_5P,_5Q,_5R){var _5S = E(_5Q);if(_5S[0]==1){var _5T = _5S[1];var _5U = _5S[2];var _5V = E(_5R);if(_5V[0]==1){var _5W = _5V[1];var _5X = _5V[2];var _5Y = _5T<_5W;if(_5Y){var _5Z = _5h(_5P,_5W,_5X,_5T,_5U);}else{var _60 = _5W>=2147483648;if(_60){var _61 = _5r(1,_5U,_5X);var _62 = _5W-2147483648>>>0;var _63 = _5T-2147483648>>>0;var _64 = _63+_62>>>0;var _65 = _64+_5P>>>0;var _66 = [1,E(_65),E(_61)];var _67 = _66;}else{var _68 = _5T>=2147483648;if(_68){var _69 = _5T-2147483648>>>0;var _6a = _69+_5W>>>0;var _6b = _6a+_5P>>>0;var _6c = _6b<2147483648;if(_6c){var _6d = _5r(0,_5U,_5X);var _6e = _6b+2147483648>>>0;var _6f = [1,E(_6e),E(_6d)];var _6g = _6f;}else{var _6h = _5r(1,_5U,_5X);var _6i = _6b-2147483648>>>0;var _6j = [1,E(_6i),E(_6h)];var _6g = _6j;}var _6k = _6g;}else{var _6l = _5r(0,_5U,_5X);var _6m = _5T+_5W>>>0;var _6n = _6m+_5P>>>0;var _6o = [1,E(_6n),E(_6l)];var _6k = _6o;}var _67 = _6k;}var _5Z = _67;}var _6p = _5Z;}else{var _6q = _5P==0;var _6p = _6q?E(_5S):_54(_5S);}var _6r = _6p;}else{var _6s = E(_5R);if(_6s[0]==1){var _6t = _5P==0;var _6u = _6t?E(_6s):_54(_6s);}else{var _6v = _5P==0;var _6u = _6v?[2]:E(_5g);}var _6r = _6u;}return _6r;};var _6w = function(_6x,_6y){while(1){var _6z = E(_6x);switch(_6z[0]){case 1:var _6A = _6z[1];var _6B = E(_6y);switch(_6B[0]){case 1:var _6C = _6B[1];var _6D = _5r(0,_6A,_6C);var _6E = [1,E(_6D)];var _6F = _6E;break;case 2:var _6G = _6B[1];var _6H = _3Z(_6A,_6G);switch(_6H[0]){case 1:var _6I = _4q(_6G,_6A);var _6J = [2,E(_6I)];var _6K = _6J;break;case 2:var _6K = [3];break;case 3:var _6L = _4q(_6A,_6G);var _6M = [1,E(_6L)];var _6K = _6M;break;}var _6F = _6K;break;case 3:var _6F = E(_6z);break;}var _6N = _6F;break;case 2:var _6O = _6z[1];var _6P = E(_6y);switch(_6P[0]){case 1:var _6Q = _6P[1];var _6R = [2,E(_6O)];var _6S = [1,E(_6Q)];_6x=_6S;_6y=_6R;continue;var _6T = die("Unreachable!");break;case 2:var _6U = _6P[1];var _6V = _5r(0,_6O,_6U);var _6W = [2,E(_6V)];var _6T = _6W;break;case 3:var _6T = E(_6z);break;}var _6N = _6T;break;case 3:var _6N = E(_6y);break;}return _6N;}};var _6X = function(_6Y,_6Z){var _70 = _6Z>>>16;var _71 = (_6Y&65535)>>>0;var _72 = imul(_71,_70)>>>0;var _73 = (_6Z&65535)>>>0;var _74 = _6Y>>>16;var _75 = imul(_74,_73)>>>0;var _76 = _72>>>16;var _77 = _75>>>16;var _78 = imul(_74,_70)>>>0;var _79 = _78+_77>>>0;var _7a = _79+_76>>>0;var _7b = imul(_71,_73)>>>0;var _7c = [1,E(_7b),E(_3I)];var _7d = (_72&65535)>>>0;var _7e = _7d<<16>>>0;var _7f = (_75&65535)>>>0;var _7g = _7f<<16>>>0;var _7h = _5h(0,_7g,_3I,_7e,_3I);var _7i = _5r(0,_7h,_7c);var _7j = _7a==0;if(_7j){var _7k = E(_7i);}else{var _7l = [1,E(_7a),E(_3I)];var _7m = [1,E(0),E(_7l)];var _7k = _5r(0,_7m,_7i);}return _7k;};var _7n = function(_7o,_7p){while(1){var _7q = E(_7o);if(_7q[0]==1){var _7r = _7q[1];var _7s = _7q[2];var _7t = E(_7p);if(_7t[0]==1){var _7u = _7t[1];var _7v = _7t[2];var _7w = E(_7s);if(_7w[0]==1){var _7x = E(_7v);if(_7x[0]==1){var _7y = _7n(_7w,_7t);var _7z = [1,E(0),E(_7y)];var _7A = [1,E(_7r),E(_3I)];var _7B = _7n(_7A,_7t);var _7C = _5r(0,_7B,_7z);var _7D = _7C;}else{var _7E = _7r==0;if(_7E){var _7F = _7n(_7w,_7t);var _7G = [1,E(0),E(_7F)];var _7H = _7G;}else{var _7I = _7n(_7w,_7t);var _7J = [1,E(0),E(_7I)];var _7K = _6X(_7r,_7u);var _7L = _5r(0,_7K,_7J);var _7H = _7L;}var _7D = _7H;}var _7M = _7D;}else{var _7N = E(_7v);if(_7N[0]==1){_7o=_7t;_7p=_7q;continue;var _7O = die("Unreachable!");}else{var _7O = _6X(_7r,_7u);}var _7M = _7O;}var _7P = _7M;}else{var _7P = E(_4g);}var _7Q = _7P;}else{var _7R = E(_7p);var _7Q = _7R[0]==1?E(_4g):E(_4g);}return _7Q;}};var _7S = function(_7T,_7U){var _7V = E(_7T);switch(_7V[0]){case 1:var _7W = _7V[1];var _7X = E(_7U);switch(_7X[0]){case 1:var _7Y = _7X[1];var _7Z = _7n(_7W,_7Y);var _80 = [1,E(_7Z)];var _81 = _80;break;case 2:var _82 = _7X[1];var _83 = _7n(_7W,_82);var _84 = [2,E(_83)];var _81 = _84;break;case 3:var _81 = [3];break;}var _85 = _81;break;case 2:var _86 = _7V[1];var _87 = E(_7U);switch(_87[0]){case 1:var _88 = _87[1];var _89 = _7n(_86,_88);var _8a = [2,E(_89)];var _8b = _8a;break;case 2:var _8c = _87[1];var _8d = _7n(_86,_8c);var _8e = [1,E(_8d)];var _8b = _8e;break;case 3:var _8b = [3];break;}var _85 = _8b;break;case 3:var _8f = E(_7U);var _8g = [3];var _85 = _8g;break;}return _85;};var _8h = function(_8i,_8j,_8k){while(1){var _8l = E(_8k);if(_8l[0]==1){var _8m = E(_8j);}else{var _8n = _8l[1];var _8o = _8l[2];var _8p = E(_8n);var _8q = _8p[1];var _8r = _3O(_8q);var _8s = _7S(_8j,_8i);var _8t = _6w(_8s,_8r);_8i=_8i;_8j=_8t;_8k=_8o;continue;var _8u = die("Unreachable!");var _8m = _8u;}return _8m;}};var _8v = I(10);var _8w = function(_8x){var _8y = E(_8x);if(_8y[0]==1){var _8z = _8y[1];var _8A = _8y[2];var _8B = T(function(){var _8C = T(function(){var _8D = E(_8z);var _8E = _8D[1];var _8F = _3O(_8E);return _8F;});return _8h(_8C,_3Y,_8A);});var _8G = [2,_8B];}else{var _8H = _8y[1];var _8I = _8y[2];var _8J = _8y[3];var _8K = E(_8I);if(_8K[0]==1){var _8L = E(_8J);if(_8L[0]==1){var _8M = T(function(){return _8h(_8v,_3Y,_8H);});var _8N = [2,_8M];}else{var _8N = [1];}var _8O = _8N;}else{var _8O = [1];}var _8G = _8O;}return _8G;};var _8P = function(_8Q){var _8R = E(_8Q);if(_8R[0]==4){var _8S = _8R[1];var _8T = _8w(_8S);if(_8T[0]==1){var _8U = E(_3w);}else{var _8V = _8T[1];var _8W = T(function(){var _8X = _3s(_8V);var _8Y = [1,_8X];return _8Y;});var _8Z = function(_90,_91){return A(_91,[_8W]);};var _8U = E(_8Z);}var _92 = _8U;}else{var _92 = E(_3z);}return _92;};var _93 = [1,0];var _94 = [1];var _95 = function(_96){return A(_96,[_94]);};var _97 = function(_98){var _99 = E(_98);if(_99[0]==1){var _9a = E(_95);}else{var _9b = _99[1];var _9c = _99[2];var _9d = E(_9b);var _9e = _9d[1];var _9f = E(_9e);switch(_9f){case '\t':var _9g = T(function(){return _97(_9c);});var _9h = function(_9i){var _9j = T(function(){return A(_9g,[_9i]);});var _9k = function(_9l){return E(_9j);};return [1,_9k];};var _9m = E(_9h);break;case '\n':var _9n = T(function(){return _97(_9c);});var _9o = function(_9p){var _9q = T(function(){return A(_9n,[_9p]);});var _9r = function(_9s){return E(_9q);};return [1,_9r];};var _9m = E(_9o);break;case '\v':var _9t = T(function(){return _97(_9c);});var _9u = function(_9v){var _9w = T(function(){return A(_9t,[_9v]);});var _9x = function(_9y){return E(_9w);};return [1,_9x];};var _9m = E(_9u);break;case '\f':var _9z = T(function(){return _97(_9c);});var _9A = function(_9B){var _9C = T(function(){return A(_9z,[_9B]);});var _9D = function(_9E){return E(_9C);};return [1,_9D];};var _9m = E(_9A);break;case '\r':var _9F = T(function(){return _97(_9c);});var _9G = function(_9H){var _9I = T(function(){return A(_9F,[_9H]);});var _9J = function(_9K){return E(_9I);};return [1,_9J];};var _9m = E(_9G);break;case ' ':var _9L = T(function(){return _97(_9c);});var _9M = function(_9N){var _9O = T(function(){return A(_9L,[_9N]);});var _9P = function(_9Q){return E(_9O);};return [1,_9P];};var _9m = E(_9M);break;case '\160':var _9R = T(function(){return _97(_9c);});var _9S = function(_9T){var _9U = T(function(){return A(_9R,[_9T]);});var _9V = function(_9W){return E(_9U);};return [1,_9V];};var _9m = E(_9S);break;default:var _9X = _9f.charCodeAt(0);var _9Y = u_iswspace(_9X,realWorld);var _9Z = _9Y[2];var _a0 = E(_9Z);if(_a0){var _a1 = T(function(){return _97(_9c);});var _a2 = function(_a3){var _a4 = T(function(){return A(_a1,[_a3]);});var _a5 = function(_a6){return E(_a4);};return [1,_a5];};var _a7 = E(_a2);}else{var _a7 = E(_95);}var _9m = _a7;}var _9a = _9m;}return _9a;};var _a8 = function(_a9){return E(_a9);};var _aa = function(_ab,_ac){var _ad = E(_ab);var _ae = _ad[1];var _af = E(_ac);var _ag = _af[1];var _ah = _ae!=_ag;return _ah;};var _ai = function(_aj,_ak){var _al = E(_aj);var _am = _al[1];var _an = E(_ak);var _ao = _an[1];var _ap = _am==_ao;return _ap;};var _aq = [1,_ai,_aa];var _ar = function(_as,_at){while(1){var _au = E(_as);if(_au[0]==1){var _av = E(_at);var _aw = _av[0]==1?true:false;}else{var _ax = _au[1];var _ay = _au[2];var _az = E(_at);if(_az[0]==1){var _aA = false;}else{var _aB = _az[1];var _aC = _az[2];var _aD = E(_ax);var _aE = _aD[1];var _aF = E(_aB);var _aG = _aF[1];var _aH = _aE==_aG;if(_aH){_as=_ay;_at=_aC;continue;var _aI = die("Unreachable!");}else{var _aI = false;}var _aA = _aI;}var _aw = _aA;}return _aw;}};var _aJ = function(_aK,_aL){var _aM = _ar(_aK,_aL);return _aM?false:true;};var _aN = [1,_ar,_aJ];var _aO = function(_aP){var _aQ = E(_aP);var _aR = _aQ[1];var _aS = E(_aR);return _aS;};var _aT = function(_aU,_aV,_aW){while(1){var _aX = E(_aW);if(_aX[0]==1){var _aY = false;}else{var _aZ = _aX[1];var _b0 = _aX[2];var _b1 = A(_aO,[_aU,_aV,_aZ]);if(_b1){var _b2 = true;}else{_aU=_aU;_aV=_aV;_aW=_b0;continue;var _b2 = die("Unreachable!");}var _aY = _b2;}return _aY;}};var _b3 = T(function(){return unCStr("base");});var _b4 = T(function(){return unCStr("Control.Exception.Base");});var _b5 = T(function(){return unCStr("PatternMatchFail");});var _b6 = [1,1.605959309876327e19,1.3945565038419476e19,_b3,_b4,_b5];var _b7 = [1,1.605959309876327e19,1.3945565038419476e19,_b6,_y];var _b8 = function(_b9){return E(_b7);};var _ba = function(_bb){var _bc = E(_bb);var _bd = _bc[1];var _be = _bc[2];var _bf = _p(_bd);var _bg = _2(_bf,_b8,_be);return _bg;};var _bh = function(_bi){var _bj = E(_bi);var _bk = _bj[1];var _bl = E(_bk);return _bl;};var _bm = function(_bn,_bo){var _bp = E(_bn);if(_bp[0]==1){var _bq = unAppCStr("[]",_bo);}else{var _br = _bp[1];var _bs = _bp[2];var _bt = T(function(){var _bu = E(_br);var _bv = _bu[1];var _bw = T(function(){var _bx = [2,_22,_bo];var _by = function(_bz){var _bA = E(_bz);if(_bA[0]==1){var _bB = E(_bx);}else{var _bC = _bA[1];var _bD = _bA[2];var _bE = T(function(){var _bF = E(_bC);var _bG = _bF[1];var _bH = T(function(){return _by(_bD);});var _bI = _J(_bG,_bH);return _bI;});var _bB = [2,_21,_bE];}return _bB;};return _by(_bs);});var _bJ = _J(_bv,_bw);return _bJ;});var _bq = [2,_23,_bt];}return _bq;};var _bK = function(_bL,_bM,_bN){var _bO = E(_bM);var _bP = _bO[1];var _bQ = _J(_bP,_bN);return _bQ;};var _bR = [1,_bK,_bh,_bm];var _bS = T(function(){return [1,_b8,_bR,_bT,_ba];});var _bT = function(_bU){return [1,_bS,_bU];};var _bV = T(function(){return unCStr("Non-exhaustive patterns in");});var _bW = function(_bX,_bY){var _bZ = T(function(){return A(_bY,[_bX]);});return die(_bZ);};var _c0 = [1,' '];var _c1 = [1,'\n'];var _c2 = [2,_c1,_y];var _c3 = function(_c4){var _c5 = E(_c4);var _c6 = _c5[1];var _c7 = E(_c6);var _c8 = _c7=='|'?false:true;return _c8;};var _c9 = function(_ca,_cb){var _cc = E(_cb);if(_cc[0]==1){var _cd = [1,_y,_y];}else{var _ce = _cc[1];var _cf = _cc[2];var _cg = A(_ca,[_ce]);if(_cg){var _ch = T(function(){var _ci = _c9(_ca,_cf);var _cj = _ci[1];var _ck = _ci[2];var _cl = [1,_cj,_ck];return _cl;});var _cm = T(function(){var _cn = E(_ch);var _co = _cn[2];var _cp = E(_co);return _cp;});var _cq = T(function(){var _cr = E(_ch);var _cs = _cr[1];var _ct = E(_cs);return _ct;});var _cu = [2,_ce,_cq];var _cv = [1,_cu,_cm];}else{var _cv = [1,_y,_cc];}var _cd = _cv;}return _cd;};var _cw = function(_cx,_cy){var _cz = unCStr(_cx);var _cA = _c9(_c3,_cz);var _cB = _cA[1];var _cC = _cA[2];var _cD = function(_cE,_cF){var _cG = T(function(){var _cH = T(function(){var _cI = T(function(){return _J(_cF,_c2);});return _J(_cy,_cI);});return unAppCStr(": ",_cH);});return _J(_cE,_cG);};var _cJ = E(_cC);if(_cJ[0]==1){var _cK = _cD(_cB,_y);}else{var _cL = _cJ[1];var _cM = _cJ[2];var _cN = E(_cL);var _cO = _cN[1];var _cP = E(_cO);if(_cP=='|'){var _cQ = [2,_c0,_cM];var _cR = _cD(_cB,_cQ);}else{var _cR = _cD(_cB,_y);}var _cK = _cR;}return _cK;};var _cS = function(_cT){var _cU = T(function(){return _cw(_cT,_bV);});var _cV = [1,_cU];return _bW(_cV,_bT);};var _cW = T(function(){return _cS("Text/ParserCombinators/ReadP.hs:(136,3)-(159,60)|function mplus");});var _cX = function(_cY,_cZ){while(1){var r=(function(_d0,_d1){var _d2 = E(_d0);switch(_d2[0]){case 1:var _d3 = _d2[1];var _d4 = E(_d1);if(_d4[0]==1){var _d5 = [1];}else{var _d6 = _d4[1];var _d7 = _d4[2];var _d8 = A(_d3,[_d6]);_cY=_d8;_cZ=_d7;return null;var _d9 = die("Unreachable!");var _d5 = _d9;}var _da = _d5;break;case 2:var _db = _d2[1];var _dc = A(_db,[_d1]);_cY=_dc;_cZ=_d1;return null;var _dd = die("Unreachable!");var _da = _dd;break;case 3:var _da = [1];break;case 4:var _de = _d2[1];var _df = _d2[2];var _dg = T(function(){return _cX(_df,_d1);});var _dh = [1,_de,_d1];var _da = [2,_dh,_dg];break;case 5:var _di = _d2[1];var _da = E(_di);break;}return _da;})(_cY,_cZ);if(null!==r)return r;}};var _dj = function(_dk,_dl){var _dm = T(function(){var _dn = E(_dl);if(_dn[0]==4){var _do = _dn[1];var _dp = _dn[2];var _dq = T(function(){return _dj(_dk,_dp);});var _dr = [4,_do,_dq];}else{var _ds = E(_dk);if(_ds[0]==3){var _dt = E(_dn);}else{var _du = E(_dn);if(_du[0]==3){var _dv = E(_ds);}else{var _dw = T(function(){var _dx = E(_du);if(_dx[0]==5){var _dy = _dx[1];var _dz = function(_dA){var _dB = T(function(){var _dC = _cX(_ds,_dA);var _dD = _J(_dC,_dy);return _dD;});return [5,_dB];};var _dE = [2,_dz];}else{var _dF = E(_ds);if(_dF[0]==2){var _dG = _dF[1];var _dH = E(_dx);if(_dH[0]==1){var _dI = function(_dJ){var _dK = A(_dG,[_dJ]);var _dL = _dj(_dK,_dH);return _dL;};var _dM = [2,_dI];}else{var _dN = _dH[1];var _dO = function(_dP){var _dQ = T(function(){return A(_dN,[_dP]);});var _dR = A(_dG,[_dP]);var _dS = _dj(_dR,_dQ);return _dS;};var _dM = [2,_dO];}var _dT = _dM;}else{var _dU = E(_dx);if(_dU[0]==1){var _dV = E(_cW);}else{var _dW = _dU[1];var _dX = function(_dY){var _dZ = T(function(){return A(_dW,[_dY]);});return _dj(_dF,_dZ);};var _dV = [2,_dX];}var _dT = _dV;}var _dE = _dT;}return _dE;});var _e0 = E(_ds);switch(_e0[0]){case 2:var _e1 = _e0[1];var _e2 = E(_du);if(_e2[0]==5){var _e3 = _e2[1];var _e4 = function(_e5){var _e6 = T(function(){var _e7 = A(_e1,[_e5]);var _e8 = _cX(_e7,_e5);var _e9 = _J(_e8,_e3);return _e9;});return [5,_e6];};var _ea = [2,_e4];}else{var _ea = E(_dw);}var _eb = _ea;break;case 5:var _ec = _e0[1];var _ed = E(_du);switch(_ed[0]){case 1:var _ee = function(_ef){var _eg = T(function(){var _eh = T(function(){return _cX(_ed,_ef);});return _J(_ec,_eh);});return [5,_eg];};var _ei = [2,_ee];break;case 2:var _ej = _ed[1];var _ek = function(_el){var _em = T(function(){var _en = T(function(){var _eo = A(_ej,[_el]);var _ep = _cX(_eo,_el);return _ep;});return _J(_ec,_en);});return [5,_em];};var _ei = [2,_ek];break;case 5:var _eq = _ed[1];var _er = T(function(){return _J(_ec,_eq);});var _ei = [5,_er];break;}var _eb = _ei;break;default:var _eb = E(_dw);}var _dv = _eb;}var _dt = _dv;}var _dr = _dt;}return _dr;});var _es = E(_dk);switch(_es[0]){case 1:var _et = _es[1];var _eu = E(_dl);if(_eu[0]==1){var _ev = _eu[1];var _ew = function(_ex){var _ey = T(function(){return A(_ev,[_ex]);});var _ez = A(_et,[_ex]);var _eA = _dj(_ez,_ey);return _eA;};var _eB = [1,_ew];}else{var _eB = E(_dm);}var _eC = _eB;break;case 4:var _eD = _es[1];var _eE = _es[2];var _eF = T(function(){return _dj(_eE,_dl);});var _eC = [4,_eD,_eF];break;default:var _eC = E(_dm);}return _eC;};var _eG = function(_eH,_eI){var _eJ = E(_eH);switch(_eJ[0]){case 1:var _eK = _eJ[1];var _eL = function(_eM){var _eN = A(_eK,[_eM]);var _eO = _eG(_eN,_eI);return _eO;};var _eP = [1,_eL];break;case 2:var _eQ = _eJ[1];var _eR = function(_eS){var _eT = A(_eQ,[_eS]);var _eU = _eG(_eT,_eI);return _eU;};var _eP = [2,_eR];break;case 3:var _eP = [3];break;case 4:var _eV = _eJ[1];var _eW = _eJ[2];var _eX = T(function(){return _eG(_eW,_eI);});var _eY = A(_eI,[_eV]);var _eZ = _dj(_eY,_eX);var _eP = _eZ;break;case 5:var _f0 = _eJ[1];var _f1 = function(_f2){var _f3 = E(_f2);if(_f3[0]==1){var _f4 = [1];}else{var _f5 = _f3[1];var _f6 = _f3[2];var _f7 = E(_f5);var _f8 = _f7[1];var _f9 = _f7[2];var _fa = T(function(){return _f1(_f6);});var _fb = A(_eI,[_f8]);var _fc = _cX(_fb,_f9);var _fd = _J(_fc,_fa);var _f4 = _fd;}return _f4;};var _fe = _f1(_f0);var _eP = _fe[0]==1?[3]:[5,_fe];break;}return _eP;};var _ff = [3];var _fg = function(_fh){return [4,_fh,_ff];};var _fi = function(_fj,_fk){var _fl = E(_fj);if(_fl){var _fm = T(function(){var _fn = _fl-1|0;var _fo = _fi(_fn,_fk);return _fo;});var _fp = function(_fq){return E(_fm);};var _fr = [1,_fp];}else{var _fr = A(_fk,[_94]);}return _fr;};var _fs = function(_ft,_fu,_fv){var _fw = T(function(){return A(_ft,[_fg]);});var _fx = function(_fy,_fz,_fA){while(1){var r=(function(_fB,_fC,_fD){var _fE = E(_fB);switch(_fE[0]){case 1:var _fF = _fE[1];var _fG = E(_fC);if(_fG[0]==1){var _fH = E(_fu);}else{var _fI = _fG[1];var _fJ = _fG[2];var _fK = _fD+1|0;var _fL = A(_fF,[_fI]);_fy=_fL;_fz=_fJ;_fA=_fK;return null;var _fM = die("Unreachable!");var _fH = _fM;}var _fN = _fH;break;case 2:var _fO = _fE[1];var _fP = A(_fO,[_fC]);_fy=_fP;_fz=_fC;_fA=_fD;return null;var _fQ = die("Unreachable!");var _fN = _fQ;break;case 3:var _fN = E(_fu);break;case 4:var _fR = function(_fS){var _fT = T(function(){return _eG(_fE,_fS);});var _fU = function(_fV){return E(_fT);};return _fi(_fD,_fU);};var _fN = E(_fR);break;case 5:var _fN = A(_eG,[_fE]);break;}return _fN;})(_fy,_fz,_fA);if(null!==r)return r;}};var _fW = function(_fX){return A(_fx,[_fw,_fX,0,_fv]);};return [2,_fW];};var _fY = function(_fZ){return A(_fZ,[_y]);};var _g0 = function(_g1,_g2){var _g3 = function(_g4){var _g5 = E(_g4);if(_g5[0]==1){var _g6 = E(_fY);}else{var _g7 = _g5[1];var _g8 = _g5[2];var _g9 = A(_g1,[_g7]);if(_g9){var _ga = T(function(){return _g3(_g8);});var _gb = function(_gc){var _gd = T(function(){var _ge = function(_gf){var _gg = [2,_g7,_gf];return A(_gc,[_gg]);};return A(_ga,[_ge]);});var _gh = function(_gi){return E(_gd);};return [1,_gh];};var _gj = E(_gb);}else{var _gj = E(_fY);}var _g6 = _gj;}return _g6;};var _gk = function(_gl){return A(_g3,[_gl,_g2]);};return [2,_gk];};var _gm = [8];var _gn = T(function(){return unCStr("_'");});var _go = function(_gp){var _gq = _gp.charCodeAt(0);var _gr = u_iswalnum(_gq,realWorld);var _gs = _gr[2];var _gt = E(_gs);if(_gt){var _gu = true;}else{var _gv = [1,_gp];var _gu = _aT(_aq,_gv,_gn);}return _gu;};var _gw = function(_gx){var _gy = E(_gx);var _gz = _gy[1];var _gA = _go(_gz);return _gA;};var _gB = function(_gC){var _gD = function(_gE){var _gF = E(_gE);var _gG = _gF[1];var _gH = _gG.charCodeAt(0);var _gI = u_iswalpha(_gH,realWorld);var _gJ = _gI[2];var _gK = E(_gJ);if(_gK){var _gL = function(_gM){var _gN = [2,_gF,_gM];var _gO = [4,_gN];return A(_gC,[_gO]);};var _gP = _g0(_gw,_gL);}else{var _gQ = E(_gG);if(_gQ=='_'){var _gR = function(_gS){var _gT = [2,_gF,_gS];var _gU = [4,_gT];return A(_gC,[_gU]);};var _gV = _g0(_gw,_gR);}else{var _gV = [3];}var _gP = _gV;}return _gP;};return [1,_gD];};var _gW = T(function(){return unCStr("!@#$%&*+./<=>?\\^|:-~");});var _gX = function(_gY){return _aT(_aq,_gY,_gW);};var _gZ = [1,8];var _h0 = [1,16];var _h1 = T(function(){return unCStr("valDig: Bad base");});var _h2 = T(function(){return err(_h1);});var _h3 = function(_h4,_h5){var _h6 = function(_h7,_h8){var _h9 = E(_h7);if(_h9[0]==1){var _ha = T(function(){return A(_h8,[_y]);});var _hb = function(_hc){return A(_hc,[_ha]);};var _hd = E(_hb);}else{var _he = _h9[1];var _hf = _h9[2];var _hg = E(_h4);var _hh = _hg[1];var _hi = E(_he);var _hj = _hi[1];var _hk = function(_hl){var _hm = T(function(){var _hn = function(_ho){var _hp = [2,_hl,_ho];return A(_h8,[_hp]);};return _h6(_hf,_hn);});var _hq = function(_hr){var _hs = T(function(){return A(_hm,[_hr]);});var _ht = function(_hu){return E(_hs);};return [1,_ht];};return E(_hq);};var _hv = E(_hh);switch(_hv){case 8:var _hw = '0'<=_hj;if(_hw){var _hx = _hj<='7';if(_hx){var _hy = _hj.charCodeAt(0);var _hz = _hy-48|0;var _hA = [1,_hz];var _hB = _hk(_hA);var _hC = _hB;}else{var _hD = T(function(){return A(_h8,[_y]);});var _hE = function(_hF){return A(_hF,[_hD]);};var _hC = E(_hE);}var _hG = _hC;}else{var _hH = T(function(){return A(_h8,[_y]);});var _hI = function(_hJ){return A(_hJ,[_hH]);};var _hG = E(_hI);}var _hK = _hG;break;case 10:var _hL = '0'<=_hj;if(_hL){var _hM = _hj<='9';if(_hM){var _hN = _hj.charCodeAt(0);var _hO = _hN-48|0;var _hP = [1,_hO];var _hQ = _hk(_hP);var _hR = _hQ;}else{var _hS = T(function(){return A(_h8,[_y]);});var _hT = function(_hU){return A(_hU,[_hS]);};var _hR = E(_hT);}var _hV = _hR;}else{var _hW = T(function(){return A(_h8,[_y]);});var _hX = function(_hY){return A(_hY,[_hW]);};var _hV = E(_hX);}var _hK = _hV;break;case 16:var _hZ = T(function(){var _i0 = 'a'<=_hj;if(_i0){var _i1 = _hj<='f';if(_i1){var _i2 = _hj.charCodeAt(0);var _i3 = _i2-97|0;var _i4 = _i3+10|0;var _i5 = [1,_i4];var _i6 = [2,_i5];var _i7 = _i6;}else{var _i8 = 'A'<=_hj;if(_i8){var _i9 = _hj<='F';if(_i9){var _ia = _hj.charCodeAt(0);var _ib = _ia-65|0;var _ic = _ib+10|0;var _id = [1,_ic];var _ie = [2,_id];var _if = _ie;}else{var _if = [1];}var _ig = _if;}else{var _ig = [1];}var _i7 = _ig;}var _ih = _i7;}else{var _ii = 'A'<=_hj;if(_ii){var _ij = _hj<='F';if(_ij){var _ik = _hj.charCodeAt(0);var _il = _ik-65|0;var _im = _il+10|0;var _in = [1,_im];var _io = [2,_in];var _ip = _io;}else{var _ip = [1];}var _iq = _ip;}else{var _iq = [1];}var _ih = _iq;}return _ih;});var _ir = '0'<=_hj;if(_ir){var _is = _hj<='9';if(_is){var _it = _hj.charCodeAt(0);var _iu = _it-48|0;var _iv = [1,_iu];var _iw = _hk(_iv);var _ix = _iw;}else{var _iy = E(_hZ);if(_iy[0]==1){var _iz = T(function(){return A(_h8,[_y]);});var _iA = function(_iB){return A(_iB,[_iz]);};var _iC = E(_iA);}else{var _iD = _iy[1];var _iC = _hk(_iD);}var _ix = _iC;}var _iE = _ix;}else{var _iF = E(_hZ);if(_iF[0]==1){var _iG = T(function(){return A(_h8,[_y]);});var _iH = function(_iI){return A(_iI,[_iG]);};var _iJ = E(_iH);}else{var _iK = _iF[1];var _iJ = _hk(_iK);}var _iE = _iJ;}var _hK = _iE;break;default:var _hK = E(_h2);}var _hd = _hK;}return _hd;};var _iL = function(_iM){var _iN = E(_iM);return _iN[0]==1?[3]:A(_h5,[_iN]);};var _iO = function(_iP){return A(_h6,[_iP,_a8,_iL]);};return [2,_iO];};var _iQ = function(_iR){var _iS = function(_iT){var _iU = T(function(){var _iV = E(_iT);var _iW = _iV[1];var _iX = _3O(_iW);return _iX;});var _iY = function(_iZ){var _j0 = T(function(){return _8h(_iU,_3Y,_iZ);});var _j1 = [6,_j0];return A(_iR,[_j1]);};return _h3(_iT,_iY);};var _j2 = T(function(){return _iS(_h0);});var _j3 = T(function(){return _iS(_gZ);});var _j4 = T(function(){return _iS(_h0);});var _j5 = T(function(){return _iS(_gZ);});var _j6 = function(_j7){var _j8 = E(_j7);var _j9 = _j8[1];var _ja = E(_j9);switch(_ja){case 'O':var _jb = E(_j5);break;case 'X':var _jb = E(_j4);break;case 'o':var _jb = E(_j3);break;case 'x':var _jb = E(_j2);break;default:var _jb = [3];}return _jb;};var _jc = [1,_j6];var _jd = function(_je){var _jf = E(_je);var _jg = _jf[1];var _jh = E(_jg);var _ji = _jh=='0'?E(_jc):[3];return _ji;};return [1,_jd];};var _jj = function(_jk){return [3];};var _jl = function(_jm){return _jj(_jm);};var _jn = function(_jo,_jp){var _jq = function(_jr){return A(_jr,[_jo]);};var _js = function(_jt,_ju){var _jv = E(_jt);if(_jv[0]==1){var _jw = E(_jq);}else{var _jx = _jv[1];var _jy = _jv[2];var _jz = E(_ju);if(_jz[0]==1){var _jA = E(_jj);}else{var _jB = _jz[1];var _jC = _jz[2];var _jD = E(_jx);var _jE = _jD[1];var _jF = E(_jB);var _jG = _jF[1];var _jH = _jE==_jG;if(_jH){var _jI = T(function(){return _js(_jy,_jC);});var _jJ = function(_jK){var _jL = T(function(){return A(_jI,[_jK]);});var _jM = function(_jN){return E(_jL);};return [1,_jM];};var _jO = E(_jJ);}else{var _jO = E(_jl);}var _jA = _jO;}var _jw = _jA;}return _jw;};var _jP = function(_jQ){return A(_js,[_jo,_jQ,_jp]);};return [2,_jP];};var _jR = T(function(){return unCStr("NaN");});var _jS = I(0);var _jT = [1,E(_jS),E(_jS)];var _jU = [7,_jT];var _jV = T(function(){return unCStr("Infinity");});var _jW = I(1);var _jX = [1,E(_jW),E(_jS)];var _jY = [7,_jX];var _jZ = function(_k0){var _k1 = T(function(){return A(_k0,[_jU]);});var _k2 = T(function(){var _k3 = T(function(){return A(_k0,[_jY]);});var _k4 = function(_k5){return E(_k3);};return _jn(_jV,_k4);});var _k6 = function(_k7){return E(_k1);};var _k8 = _jn(_jR,_k6);var _k9 = _dj(_k8,_k2);return _k9;};var _ka = false;var _kb = function(_kc,_kd){var _ke = E(_kc);switch(_ke[0]){case 1:var _kf = _ke[1];var _kg = E(_kd);if(_kg[0]==1){var _kh = _kg[1];var _ki = _3Z(_kf,_kh);}else{var _ki = [3];}var _kj = _ki;break;case 2:var _kk = _ke[1];var _kl = E(_kd);if(_kl[0]==2){var _km = _kl[1];var _kn = _3Z(_km,_kk);}else{var _kn = [1];}var _kj = _kn;break;case 3:var _ko = E(_kd);switch(_ko[0]){case 1:var _kp = [1];break;case 2:var _kp = [3];break;case 3:var _kp = [2];break;}var _kj = _kp;break;}return _kj;};var _kq = function(_kr,_ks){var _kt = _kb(_kr,_ks);return _kt[0]==3?false:true;};var _ku = true;var _kv = function(_kw){var _kx = T(function(){return A(_kw,[_h0]);});var _ky = T(function(){return A(_kw,[_gZ]);});var _kz = T(function(){return A(_kw,[_h0]);});var _kA = T(function(){return A(_kw,[_gZ]);});var _kB = function(_kC){var _kD = E(_kC);var _kE = _kD[1];var _kF = E(_kE);switch(_kF){case 'O':var _kG = E(_kA);break;case 'X':var _kG = E(_kz);break;case 'o':var _kG = E(_ky);break;case 'x':var _kG = E(_kx);break;default:var _kG = [3];}return _kG;};return [1,_kB];};var _kH = [1,10];var _kI = function(_kJ){return A(_kJ,[_kH]);};var _kK = function(_kL){return [3];};var _kM = function(_kN){var _kO = E(_kN);if(_kO[0]==1){var _kP = E(_kK);}else{var _kQ = _kO[1];var _kR = _kO[2];var _kS = E(_kR);if(_kS[0]==1){var _kT = E(_kQ);}else{var _kU = T(function(){return _kM(_kS);});var _kV = function(_kW){var _kX = T(function(){return A(_kU,[_kW]);});var _kY = A(_kQ,[_kW]);var _kZ = _dj(_kY,_kX);return _kZ;};var _kT = E(_kV);}var _kP = _kT;}return _kP;};var _l0 = T(function(){return unCStr("SOH");});var _l1 = [1,'\SOH'];var _l2 = function(_l3){var _l4 = T(function(){return A(_l3,[_l1]);});var _l5 = function(_l6){return E(_l4);};return _jn(_l0,_l5);};var _l7 = T(function(){return unCStr("SO");});var _l8 = [1,'\SO'];var _l9 = function(_la){var _lb = T(function(){return A(_la,[_l8]);});var _lc = function(_ld){return E(_lb);};return _jn(_l7,_lc);};var _le = function(_lf){return _fs(_l2,_l9,_lf);};var _lg = T(function(){return unCStr("NUL");});var _lh = [1,'\NUL'];var _li = function(_lj){var _lk = T(function(){return A(_lj,[_lh]);});var _ll = function(_lm){return E(_lk);};return _jn(_lg,_ll);};var _ln = T(function(){return unCStr("STX");});var _lo = [1,'\STX'];var _lp = function(_lq){var _lr = T(function(){return A(_lq,[_lo]);});var _ls = function(_lt){return E(_lr);};return _jn(_ln,_ls);};var _lu = T(function(){return unCStr("ETX");});var _lv = [1,'\ETX'];var _lw = function(_lx){var _ly = T(function(){return A(_lx,[_lv]);});var _lz = function(_lA){return E(_ly);};return _jn(_lu,_lz);};var _lB = T(function(){return unCStr("EOT");});var _lC = [1,'\EOT'];var _lD = function(_lE){var _lF = T(function(){return A(_lE,[_lC]);});var _lG = function(_lH){return E(_lF);};return _jn(_lB,_lG);};var _lI = T(function(){return unCStr("ENQ");});var _lJ = [1,'\ENQ'];var _lK = function(_lL){var _lM = T(function(){return A(_lL,[_lJ]);});var _lN = function(_lO){return E(_lM);};return _jn(_lI,_lN);};var _lP = T(function(){return unCStr("ACK");});var _lQ = [1,'\ACK'];var _lR = function(_lS){var _lT = T(function(){return A(_lS,[_lQ]);});var _lU = function(_lV){return E(_lT);};return _jn(_lP,_lU);};var _lW = T(function(){return unCStr("BEL");});var _lX = [1,'\a'];var _lY = function(_lZ){var _m0 = T(function(){return A(_lZ,[_lX]);});var _m1 = function(_m2){return E(_m0);};return _jn(_lW,_m1);};var _m3 = T(function(){return unCStr("BS");});var _m4 = [1,'\b'];var _m5 = function(_m6){var _m7 = T(function(){return A(_m6,[_m4]);});var _m8 = function(_m9){return E(_m7);};return _jn(_m3,_m8);};var _ma = T(function(){return unCStr("HT");});var _mb = [1,'\t'];var _mc = function(_md){var _me = T(function(){return A(_md,[_mb]);});var _mf = function(_mg){return E(_me);};return _jn(_ma,_mf);};var _mh = T(function(){return unCStr("LF");});var _mi = [1,'\n'];var _mj = function(_mk){var _ml = T(function(){return A(_mk,[_mi]);});var _mm = function(_mn){return E(_ml);};return _jn(_mh,_mm);};var _mo = T(function(){return unCStr("VT");});var _mp = [1,'\v'];var _mq = function(_mr){var _ms = T(function(){return A(_mr,[_mp]);});var _mt = function(_mu){return E(_ms);};return _jn(_mo,_mt);};var _mv = T(function(){return unCStr("FF");});var _mw = [1,'\f'];var _mx = function(_my){var _mz = T(function(){return A(_my,[_mw]);});var _mA = function(_mB){return E(_mz);};return _jn(_mv,_mA);};var _mC = T(function(){return unCStr("CR");});var _mD = [1,'\r'];var _mE = function(_mF){var _mG = T(function(){return A(_mF,[_mD]);});var _mH = function(_mI){return E(_mG);};return _jn(_mC,_mH);};var _mJ = T(function(){return unCStr("SI");});var _mK = [1,'\SI'];var _mL = function(_mM){var _mN = T(function(){return A(_mM,[_mK]);});var _mO = function(_mP){return E(_mN);};return _jn(_mJ,_mO);};var _mQ = T(function(){return unCStr("DLE");});var _mR = [1,'\DLE'];var _mS = function(_mT){var _mU = T(function(){return A(_mT,[_mR]);});var _mV = function(_mW){return E(_mU);};return _jn(_mQ,_mV);};var _mX = T(function(){return unCStr("DC1");});var _mY = [1,'\DC1'];var _mZ = function(_n0){var _n1 = T(function(){return A(_n0,[_mY]);});var _n2 = function(_n3){return E(_n1);};return _jn(_mX,_n2);};var _n4 = T(function(){return unCStr("DC2");});var _n5 = [1,'\DC2'];var _n6 = function(_n7){var _n8 = T(function(){return A(_n7,[_n5]);});var _n9 = function(_na){return E(_n8);};return _jn(_n4,_n9);};var _nb = T(function(){return unCStr("DC3");});var _nc = [1,'\DC3'];var _nd = function(_ne){var _nf = T(function(){return A(_ne,[_nc]);});var _ng = function(_nh){return E(_nf);};return _jn(_nb,_ng);};var _ni = T(function(){return unCStr("DC4");});var _nj = [1,'\DC4'];var _nk = function(_nl){var _nm = T(function(){return A(_nl,[_nj]);});var _nn = function(_no){return E(_nm);};return _jn(_ni,_nn);};var _np = T(function(){return unCStr("NAK");});var _nq = [1,'\NAK'];var _nr = function(_ns){var _nt = T(function(){return A(_ns,[_nq]);});var _nu = function(_nv){return E(_nt);};return _jn(_np,_nu);};var _nw = T(function(){return unCStr("SYN");});var _nx = [1,'\SYN'];var _ny = function(_nz){var _nA = T(function(){return A(_nz,[_nx]);});var _nB = function(_nC){return E(_nA);};return _jn(_nw,_nB);};var _nD = T(function(){return unCStr("ETB");});var _nE = [1,'\ETB'];var _nF = function(_nG){var _nH = T(function(){return A(_nG,[_nE]);});var _nI = function(_nJ){return E(_nH);};return _jn(_nD,_nI);};var _nK = T(function(){return unCStr("CAN");});var _nL = [1,'\CAN'];var _nM = function(_nN){var _nO = T(function(){return A(_nN,[_nL]);});var _nP = function(_nQ){return E(_nO);};return _jn(_nK,_nP);};var _nR = T(function(){return unCStr("EM");});var _nS = [1,'\EM'];var _nT = function(_nU){var _nV = T(function(){return A(_nU,[_nS]);});var _nW = function(_nX){return E(_nV);};return _jn(_nR,_nW);};var _nY = T(function(){return unCStr("SUB");});var _nZ = [1,'\SUB'];var _o0 = function(_o1){var _o2 = T(function(){return A(_o1,[_nZ]);});var _o3 = function(_o4){return E(_o2);};return _jn(_nY,_o3);};var _o5 = T(function(){return unCStr("ESC");});var _o6 = [1,'\ESC'];var _o7 = function(_o8){var _o9 = T(function(){return A(_o8,[_o6]);});var _oa = function(_ob){return E(_o9);};return _jn(_o5,_oa);};var _oc = T(function(){return unCStr("FS");});var _od = [1,'\FS'];var _oe = function(_of){var _og = T(function(){return A(_of,[_od]);});var _oh = function(_oi){return E(_og);};return _jn(_oc,_oh);};var _oj = T(function(){return unCStr("GS");});var _ok = [1,'\GS'];var _ol = function(_om){var _on = T(function(){return A(_om,[_ok]);});var _oo = function(_op){return E(_on);};return _jn(_oj,_oo);};var _oq = T(function(){return unCStr("RS");});var _or = [1,'\RS'];var _os = function(_ot){var _ou = T(function(){return A(_ot,[_or]);});var _ov = function(_ow){return E(_ou);};return _jn(_oq,_ov);};var _ox = T(function(){return unCStr("US");});var _oy = [1,'\US'];var _oz = function(_oA){var _oB = T(function(){return A(_oA,[_oy]);});var _oC = function(_oD){return E(_oB);};return _jn(_ox,_oC);};var _oE = T(function(){return unCStr("SP");});var _oF = [1,' '];var _oG = function(_oH){var _oI = T(function(){return A(_oH,[_oF]);});var _oJ = function(_oK){return E(_oI);};return _jn(_oE,_oJ);};var _oL = T(function(){return unCStr("DEL");});var _oM = [1,'\DEL'];var _oN = function(_oO){var _oP = T(function(){return A(_oO,[_oM]);});var _oQ = function(_oR){return E(_oP);};return _jn(_oL,_oQ);};var _oS = [2,_oN,_y];var _oT = [2,_oG,_oS];var _oU = [2,_oz,_oT];var _oV = [2,_os,_oU];var _oW = [2,_ol,_oV];var _oX = [2,_oe,_oW];var _oY = [2,_o7,_oX];var _oZ = [2,_o0,_oY];var _p0 = [2,_nT,_oZ];var _p1 = [2,_nM,_p0];var _p2 = [2,_nF,_p1];var _p3 = [2,_ny,_p2];var _p4 = [2,_nr,_p3];var _p5 = [2,_nk,_p4];var _p6 = [2,_nd,_p5];var _p7 = [2,_n6,_p6];var _p8 = [2,_mZ,_p7];var _p9 = [2,_mS,_p8];var _pa = [2,_mL,_p9];var _pb = [2,_mE,_pa];var _pc = [2,_mx,_pb];var _pd = [2,_mq,_pc];var _pe = [2,_mj,_pd];var _pf = [2,_mc,_pe];var _pg = [2,_m5,_pf];var _ph = [2,_lY,_pg];var _pi = [2,_lR,_ph];var _pj = [2,_lK,_pi];var _pk = [2,_lD,_pj];var _pl = [2,_lw,_pk];var _pm = [2,_lp,_pl];var _pn = [2,_li,_pm];var _po = [2,_le,_pn];var _pp = T(function(){return _kM(_po);});var _pq = T(function(){return _3O(1114111);});var _pr = [1,'"'];var _ps = [1,_pr,_ku];var _pt = [1,'\''];var _pu = [1,_pt,_ku];var _pv = [1,'\\'];var _pw = [1,_pv,_ku];var _px = [1,_lX,_ku];var _py = [1,_m4,_ku];var _pz = [1,_mw,_ku];var _pA = [1,_mi,_ku];var _pB = [1,_mD,_ku];var _pC = [1,_mb,_ku];var _pD = [1,_mp,_ku];var _pE = [1,'-'];var _pF = function(_pG,_pH){while(1){var _pI = _pG<10;if(_pI){var _pJ = 48+_pG|0;var _pK = String.fromCharCode(_pJ);var _pL = [1,_pK];var _pM = [2,_pL,_pH];var _pN = _pM;}else{var _pO = _pG%10;var _pP = 48+_pO|0;var _pQ = String.fromCharCode(_pP);var _pR = [1,_pQ];var _pS = [2,_pR,_pH];var _pT = quot(_pG,10);_pG=_pT;_pH=_pS;continue;var _pU = die("Unreachable!");var _pN = _pU;}return _pN;}};var _pV = function(_pW,_pX){var _pY = _pW<0;if(_pY){var _pZ = E(_pW);if(_pZ==(-2147483648)){var _q0 = T(function(){var _q1 = T(function(){return _pF(8,_pX);});return _pF(214748364,_q1);});var _q2 = [2,_pE,_q0];}else{var _q3 = T(function(){var _q4 = -_pZ;var _q5 = _pF(_q4,_pX);return _q5;});var _q2 = [2,_pE,_q3];}var _q6 = _q2;}else{var _q6 = _pF(_pW,_pX);}return _q6;};var _q7 = [1,')'];var _q8 = [1,'('];var _q9 = function(_qa,_qb,_qc){var _qd = _qb<0;if(_qd){var _qe = _qa>6;if(_qe){var _qf = T(function(){var _qg = [2,_q7,_qc];return _pV(_qb,_qg);});var _qh = [2,_q8,_qf];}else{var _qh = _pV(_qb,_qc);}var _qi = _qh;}else{var _qi = _pV(_qb,_qc);}return _qi;};var _qj = function(_qk){var _ql = T(function(){return _q9(9,_qk,_y);});var _qm = unAppCStr("Prelude.chr: bad argument: ",_ql);var _qn = err(_qm);return _qn;};var _qo = function(_qp){var _qq = E(_qp);var _qr = _qq[1];var _qs = _qj(_qr);return _qs;};var _qt = function(_qu){var _qv = [1,_qu];return _qo(_qv);};var _qw = [1,_lh,_ku];var _qx = [1,_l1,_ku];var _qy = [1,_lo,_ku];var _qz = [1,_lv,_ku];var _qA = [1,_lC,_ku];var _qB = [1,_lJ,_ku];var _qC = [1,_lQ,_ku];var _qD = [1,_lX,_ku];var _qE = [1,_m4,_ku];var _qF = [1,_mb,_ku];var _qG = [1,_mi,_ku];var _qH = [1,_mp,_ku];var _qI = [1,_mw,_ku];var _qJ = [1,_mD,_ku];var _qK = [1,_l8,_ku];var _qL = [1,_mK,_ku];var _qM = [1,_mR,_ku];var _qN = [1,_mY,_ku];var _qO = [1,_n5,_ku];var _qP = [1,_nc,_ku];var _qQ = [1,_nj,_ku];var _qR = [1,_nq,_ku];var _qS = [1,_nx,_ku];var _qT = [1,_nE,_ku];var _qU = [1,_nL,_ku];var _qV = [1,_nS,_ku];var _qW = [1,_nZ,_ku];var _qX = [1,_o6,_ku];var _qY = [1,_od,_ku];var _qZ = [1,_ok,_ku];var _r0 = [1,_or,_ku];var _r1 = [1,_oy,_ku];var _r2 = function(_r3){var _r4 = T(function(){return A(_r3,[_pD]);});var _r5 = T(function(){return A(_r3,[_pC]);});var _r6 = T(function(){return A(_r3,[_pB]);});var _r7 = T(function(){return A(_r3,[_pA]);});var _r8 = T(function(){return A(_r3,[_pz]);});var _r9 = T(function(){return A(_r3,[_py]);});var _ra = T(function(){return A(_r3,[_px]);});var _rb = T(function(){return A(_r3,[_pw]);});var _rc = T(function(){return A(_r3,[_pu]);});var _rd = T(function(){return A(_r3,[_ps]);});var _re = T(function(){var _rf = T(function(){var _rg = T(function(){return A(_r3,[_r1]);});var _rh = T(function(){return A(_r3,[_r0]);});var _ri = T(function(){return A(_r3,[_qZ]);});var _rj = T(function(){return A(_r3,[_qY]);});var _rk = T(function(){return A(_r3,[_qX]);});var _rl = T(function(){return A(_r3,[_qW]);});var _rm = T(function(){return A(_r3,[_qV]);});var _rn = T(function(){return A(_r3,[_qU]);});var _ro = T(function(){return A(_r3,[_qT]);});var _rp = T(function(){return A(_r3,[_qS]);});var _rq = T(function(){return A(_r3,[_qR]);});var _rr = T(function(){return A(_r3,[_qQ]);});var _rs = T(function(){return A(_r3,[_qP]);});var _rt = T(function(){return A(_r3,[_qO]);});var _ru = T(function(){return A(_r3,[_qN]);});var _rv = T(function(){return A(_r3,[_qM]);});var _rw = T(function(){return A(_r3,[_qL]);});var _rx = T(function(){return A(_r3,[_qK]);});var _ry = T(function(){return A(_r3,[_qJ]);});var _rz = T(function(){return A(_r3,[_qI]);});var _rA = T(function(){return A(_r3,[_qH]);});var _rB = T(function(){return A(_r3,[_qG]);});var _rC = T(function(){return A(_r3,[_qF]);});var _rD = T(function(){return A(_r3,[_qE]);});var _rE = T(function(){return A(_r3,[_qD]);});var _rF = T(function(){return A(_r3,[_qC]);});var _rG = T(function(){return A(_r3,[_qB]);});var _rH = T(function(){return A(_r3,[_qA]);});var _rI = T(function(){return A(_r3,[_qz]);});var _rJ = T(function(){return A(_r3,[_qy]);});var _rK = T(function(){return A(_r3,[_qx]);});var _rL = T(function(){return A(_r3,[_qw]);});var _rM = function(_rN){var _rO = E(_rN);var _rP = _rO[1];var _rQ = E(_rP);switch(_rQ){case '@':var _rR = E(_rL);break;case 'A':var _rR = E(_rK);break;case 'B':var _rR = E(_rJ);break;case 'C':var _rR = E(_rI);break;case 'D':var _rR = E(_rH);break;case 'E':var _rR = E(_rG);break;case 'F':var _rR = E(_rF);break;case 'G':var _rR = E(_rE);break;case 'H':var _rR = E(_rD);break;case 'I':var _rR = E(_rC);break;case 'J':var _rR = E(_rB);break;case 'K':var _rR = E(_rA);break;case 'L':var _rR = E(_rz);break;case 'M':var _rR = E(_ry);break;case 'N':var _rR = E(_rx);break;case 'O':var _rR = E(_rw);break;case 'P':var _rR = E(_rv);break;case 'Q':var _rR = E(_ru);break;case 'R':var _rR = E(_rt);break;case 'S':var _rR = E(_rs);break;case 'T':var _rR = E(_rr);break;case 'U':var _rR = E(_rq);break;case 'V':var _rR = E(_rp);break;case 'W':var _rR = E(_ro);break;case 'X':var _rR = E(_rn);break;case 'Y':var _rR = E(_rm);break;case 'Z':var _rR = E(_rl);break;case '[':var _rR = E(_rk);break;case '\\':var _rR = E(_rj);break;case ']':var _rR = E(_ri);break;case '^':var _rR = E(_rh);break;case '_':var _rR = E(_rg);break;default:var _rR = [3];}return _rR;};var _rS = [1,_rM];var _rT = T(function(){var _rU = function(_rV){var _rW = [1,_rV,_ku];return A(_r3,[_rW]);};return A(_pp,[_rU]);});var _rX = function(_rY){var _rZ = E(_rY);var _s0 = _rZ[1];var _s1 = E(_s0);var _s2 = _s1=='^'?E(_rS):[3];return _s2;};var _s3 = [1,_rX];return _dj(_s3,_rT);});var _s4 = function(_s5){var _s6 = T(function(){var _s7 = E(_s5);var _s8 = _s7[1];var _s9 = _3O(_s8);return _s9;});var _sa = function(_sb){var _sc = _8h(_s6,_3Y,_sb);var _sd = _kq(_sc,_pq);if(_sd){var _se = T(function(){var _sf = _3s(_sc);var _sg = _sf>>>0;var _sh = _sg<=1114111;if(_sh){var _si = String.fromCharCode(_sf);var _sj = [1,_si];var _sk = _sj;}else{var _sk = _qt(_sf);}return _sk;});var _sl = [1,_se,_ku];var _sm = A(_r3,[_sl]);}else{var _sm = [3];}return _sm;};return _h3(_s5,_sa);};var _sn = _fs(_kv,_kI,_s4);var _so = _dj(_sn,_rf);return _so;});var _sp = function(_sq){var _sr = E(_sq);var _ss = _sr[1];var _st = E(_ss);switch(_st){case '"':var _su = E(_rd);break;case '\'':var _su = E(_rc);break;case '\\':var _su = E(_rb);break;case 'a':var _su = E(_ra);break;case 'b':var _su = E(_r9);break;case 'f':var _su = E(_r8);break;case 'n':var _su = E(_r7);break;case 'r':var _su = E(_r6);break;case 't':var _su = E(_r5);break;case 'v':var _su = E(_r4);break;default:var _su = [3];}return _su;};var _sv = [1,_sp];return _dj(_sv,_re);};var _sw = function(_sx){var _sy = T(function(){return _r2(_sx);});var _sz = T(function(){return _sw(_sx);});var _sA = function(_sB){var _sC = E(_sB);var _sD = _sC[1];var _sE = E(_sD);var _sF = _sE=='\\'?E(_sz):[3];return _sF;};var _sG = [1,_sA];var _sH = function(_sI){return E(_sG);};var _sJ = function(_sK){return A(_97,[_sK,_sH]);};var _sL = [2,_sJ];var _sM = function(_sN){var _sO = E(_sN);var _sP = _sO[1];var _sQ = E(_sP);switch(_sQ){case '\t':var _sR = E(_sL);break;case '\n':var _sR = E(_sL);break;case '\v':var _sR = E(_sL);break;case '\f':var _sR = E(_sL);break;case '\r':var _sR = E(_sL);break;case ' ':var _sR = E(_sL);break;case '&':var _sR = E(_sz);break;case '\160':var _sR = E(_sL);break;default:var _sS = _sQ.charCodeAt(0);var _sT = u_iswspace(_sS,realWorld);var _sU = _sT[2];var _sV = E(_sU);var _sW = _sV?E(_sL):[3];var _sR = _sW;}return _sR;};var _sX = [1,_sM];var _sY = function(_sZ){var _t0 = E(_sZ);var _t1 = _t0[1];var _t2 = E(_t1);if(_t2=='\\'){var _t3 = E(_sy);}else{var _t4 = [1,_t0,_ka];var _t3 = A(_sx,[_t4]);}return _t3;};var _t5 = [1,_sY];var _t6 = function(_t7){var _t8 = E(_t7);var _t9 = _t8[1];var _ta = E(_t9);var _tb = _ta=='\\'?E(_sX):[3];return _tb;};var _tc = [1,_t6];return _dj(_tc,_t5);};var _td = function(_te,_tf){var _tg = T(function(){var _th = T(function(){return A(_te,[_y]);});var _ti = [2,_th];return A(_tf,[_ti]);});var _tj = function(_tk){var _tl = E(_tk);var _tm = _tl[1];var _tn = _tl[2];var _to = E(_tm);var _tp = _to[1];var _tq = E(_tp);if(_tq=='"'){var _tr = E(_tn);if(_tr){var _ts = function(_tt){var _tu = [2,_to,_tt];return A(_te,[_tu]);};var _tv = _td(_ts,_tf);}else{var _tv = E(_tg);}var _tw = _tv;}else{var _tx = function(_ty){var _tz = [2,_to,_ty];return A(_te,[_tz]);};var _tw = _td(_tx,_tf);}return _tw;};return _sw(_tj);};var _tA = function(_tB){var _tC = E(_tB);if(_tC[0]==2){var _tD = _tC[1];var _tE = [1,E(_tD)];}else{var _tE = E(_tC);}return _tE;};var _tF = function(_tG,_tH){var _tI = _kb(_tG,_tH);return _tI[0]==1?false:true;};var _tJ = [2,E(_53)];var _tK = [1,E(_53)];var _tL = function(_tM){var _tN = E(_tM);switch(_tN[0]){case 1:var _tO = E(_tK);break;case 2:var _tO = E(_tJ);break;case 3:var _tO = [3];break;}return _tO;};var _tP = T(function(){return unCStr("base");});var _tQ = T(function(){return unCStr("GHC.Exception");});var _tR = T(function(){return unCStr("ArithException");});var _tS = [1,3089387606753565184,7918018744409604096,_tP,_tQ,_tR];var _tT = [1,3089387606753565184,7918018744409604096,_tS,_y];var _tU = function(_tV){return E(_tT);};var _tW = function(_tX){var _tY = E(_tX);var _tZ = _tY[1];var _u0 = _tY[2];var _u1 = _p(_tZ);var _u2 = _2(_u1,_tU,_u0);return _u2;};var _u3 = T(function(){return unCStr("denormal");});var _u4 = T(function(){return unCStr("divide by zero");});var _u5 = T(function(){return unCStr("loss of precision");});var _u6 = T(function(){return unCStr("arithmetic underflow");});var _u7 = T(function(){return unCStr("arithmetic overflow");});var _u8 = function(_u9){var _ua = E(_u9);switch(_ua[0]){case 1:var _ub = E(_u7);break;case 2:var _ub = E(_u6);break;case 3:var _ub = E(_u5);break;case 4:var _ub = E(_u4);break;case 5:var _ub = E(_u3);break;}return _ub;};var _uc = function(_ud,_ue){var _uf = E(_ud);if(_uf[0]==1){var _ug = unAppCStr("[]",_ue);}else{var _uh = _uf[1];var _ui = _uf[2];var _uj = T(function(){var _uk = T(function(){var _ul = [2,_22,_ue];var _um = function(_un){var _uo = E(_un);if(_uo[0]==1){var _up = E(_ul);}else{var _uq = _uo[1];var _ur = _uo[2];var _us = T(function(){var _ut = E(_uq);switch(_ut[0]){case 1:var _uu = T(function(){return _um(_ur);});var _uv = _J(_u7,_uu);break;case 2:var _uw = T(function(){return _um(_ur);});var _uv = _J(_u6,_uw);break;case 3:var _ux = T(function(){return _um(_ur);});var _uv = _J(_u5,_ux);break;case 4:var _uy = T(function(){return _um(_ur);});var _uv = _J(_u4,_uy);break;case 5:var _uz = T(function(){return _um(_ur);});var _uv = _J(_u3,_uz);break;}return _uv;});var _up = [2,_21,_us];}return _up;};return _um(_ui);});var _uA = E(_uh);switch(_uA[0]){case 1:var _uB = _J(_u7,_uk);break;case 2:var _uB = _J(_u6,_uk);break;case 3:var _uB = _J(_u5,_uk);break;case 4:var _uB = _J(_u4,_uk);break;case 5:var _uB = _J(_u3,_uk);break;}return _uB;});var _ug = [2,_23,_uj];}return _ug;};var _uC = function(_uD){return _J(_u7,_uD);};var _uE = function(_uD){return _J(_u3,_uD);};var _uF = function(_uD){return _J(_u4,_uD);};var _uG = function(_uD){return _J(_u5,_uD);};var _uH = function(_uD){return _J(_u6,_uD);};var _uI = function(_uJ,_uK){var _uL = E(_uK);switch(_uL[0]){case 1:var _uM = E(_uC);break;case 2:var _uM = E(_uH);break;case 3:var _uM = E(_uG);break;case 4:var _uM = E(_uF);break;case 5:var _uM = E(_uE);break;}return _uM;};var _uN = [1,_uI,_u8,_uc];var _uO = T(function(){return [1,_tU,_uN,_uP,_tW];});var _uP = function(_uD){return [1,_uO,_uD];};var _uQ = [4];var _uR = T(function(){return _bW(_uQ,_uP);});var _uS = function(_uT,_uU){var _uV = _kb(_uT,_uU);return _uV[0]==2?true:false;};var _uW = [3];var _uX = [1,E(_4g)];var _uY = [1];var _uZ = function(_v0){var _v1 = E(_v0);return _v1[0]==1?[1,E(_v1)]:[3];};var _v2 = function(_v3,_v4,_v5){while(1){var _v6 = E(_v4);if(_v6[0]==1){var _v7 = E(_v5);var _v8 = [1,_v3,_v7];var _v9 = _v8;}else{var _va = _v6[1];var _vb = _v6[2];var _vc = _3Z(_v5,_va);if(_vc[0]==1){var _vd = _v3<<1>>>0;_v3=_vd;_v4=_vb;_v5=_v5;continue;var _ve = die("Unreachable!");var _vf = _ve;}else{var _vg = _4q(_v5,_va);var _vh = _v3<<1>>>0;var _vi = _vh+1>>>0;_v3=_vi;_v4=_vb;_v5=_vg;continue;var _vj = die("Unreachable!");var _vf = _vj;}var _v9 = _vf;}return _v9;}};var _vk = function(_vl,_vm){var _vn = E(_vm);if(_vn){var _vo = 32-_vn|0;var _vp = function(_vq,_vr){var _vs = E(_vr);if(_vs[0]==1){var _vt = _vs[1];var _vu = _vs[2];var _vv = _vt>>>_vo;var _vw = _vp(_vv,_vu);var _vx = _vt<<_vn>>>0;var _vy = (_vx|_vq)>>>0;var _vz = [1,E(_vy),E(_vw)];var _vA = _vz;}else{var _vB = _vq==0;var _vA = _vB?[2]:[1,E(_vq),E(_3I)];}return _vA;};var _vC = _vp(0,_vl);var _vD = _vC;}else{var _vD = E(_vl);}return _vD;};var _vE = function(_vF,_vG){var _vH = E(_vG);if(_vH[0]==1){var _vI = [1,E(_vF),E(_vH)];}else{var _vJ = _vF==0;var _vI = _vJ?[2]:[1,E(_vF),E(_3I)];}return _vI;};var _vK = function(_vL,_vM){var _vN = E(_vM);var _vO = T(function(){var _vP = [2,_vN,_uY];var _vQ = function(_vR){var _vS = E(_vR);if(_vS){var _vT = T(function(){var _vU = _vS-1|0;var _vV = _vQ(_vU);return _vV;});var _vW = T(function(){return _vk(_vN,_vS);});var _vX = [2,_vW,_vT];}else{var _vX = E(_vP);}return _vX;};return _vQ(31);});var _vY = function(_vZ){var _w0 = E(_vZ);if(_w0[0]==1){var _w1 = _w0[1];var _w2 = _w0[2];var _w3 = _vY(_w2);var _w4 = _w3[1];var _w5 = _w3[2];var _w6 = E(_w5);if(_w6[0]==1){var _w7 = [1,E(_w1),E(_w6)];var _w8 = _v2(0,_vO,_w7);var _w9 = _w8[1];var _wa = _w8[2];var _wb = T(function(){return _vE(_w9,_w4);});var _wc = [1,_wb,_wa];var _wd = _wc;}else{var _we = _w1==0;if(_we){var _wf = _v2(0,_vO,_3I);var _wg = _wf[1];var _wh = _wf[2];var _wi = T(function(){return _vE(_wg,_w4);});var _wj = [1,_wi,_wh];var _wk = _wj;}else{var _wl = [1,E(_w1),E(_3I)];var _wm = _v2(0,_vO,_wl);var _wn = _wm[1];var _wo = _wm[2];var _wp = T(function(){return _vE(_wn,_w4);});var _wq = [1,_wp,_wo];var _wk = _wq;}var _wd = _wk;}var _wr = _wd;}else{var _wr = [1,_3I,_3I];}return _wr;};var _ws = _vY(_vL);var _wt = _ws[1];var _wu = _ws[2];var _wv = T(function(){return _uZ(_wu);});var _ww = T(function(){return _uZ(_wt);});var _wx = [1,_ww,_wv];return _wx;};var _wy = function(_wz,_wA){var _wB = E(_wz);if(_wB[0]==3){var _wC = E(_wA);var _wD = [1,_uW,_uW];var _wE = _wD;}else{var _wF = E(_wA);if(_wF[0]==3){var _wG = [1,_uX,_uX];}else{var _wH = E(_wB);if(_wH[0]==1){var _wI = _wH[1];var _wJ = E(_wF);if(_wJ[0]==1){var _wK = _wJ[1];var _wL = _vK(_wI,_wK);}else{var _wM = _wJ[1];var _wN = _vK(_wI,_wM);var _wO = _wN[1];var _wP = _wN[2];var _wQ = T(function(){return _3C(_wO);});var _wR = [1,_wQ,_wP];var _wL = _wR;}var _wS = _wL;}else{var _wT = _wH[1];var _wU = E(_wF);if(_wU[0]==1){var _wV = _wU[1];var _wW = _vK(_wT,_wV);var _wX = _wW[1];var _wY = _wW[2];var _wZ = T(function(){return _3C(_wY);});var _x0 = T(function(){return _3C(_wX);});var _x1 = [1,_x0,_wZ];var _x2 = _x1;}else{var _x3 = _wU[1];var _x4 = _vK(_wT,_x3);var _x5 = _x4[1];var _x6 = _x4[2];var _x7 = T(function(){return _3C(_x6);});var _x8 = [1,_x5,_x7];var _x2 = _x8;}var _wS = _x2;}var _wG = _wS;}var _wE = _wG;}return _wE;};var _x9 = function(_xa,_xb){var _xc = _wy(_xa,_xb);var _xd = _xc[1];var _xe = E(_xd);return _xe;};var _xf = T(function(){return unCStr("Ratio.%: zero denominator");});var _xg = T(function(){return err(_xf);});var _xh = function(_xi,_xj){var _xk = _uS(_xj,_jS);if(_xk){var _xl = E(_xg);}else{var _xm = _xn(_xi,_xj);var _xo = _uS(_xm,_jS);if(_xo){var _xp = E(_uR);}else{var _xq = _x9(_xi,_xm);var _xr = _x9(_xj,_xm);var _xs = [1,_xq,_xr];var _xp = _xs;}var _xl = _xp;}return _xl;};var _xt = function(_xu,_xv){var _xw = _kb(_xu,_xv);return _xw[0]==1?true:false;};var _xx = T(function(){return unCStr("Negative exponent");});var _xy = T(function(){return err(_xx);});var _xz = function(_xA,_xB){var _xC = _3C(_xB);var _xD = _6w(_xA,_xC);return _xD;};var _xE = function(_xF,_xG){var _xH = _wy(_xF,_xG);var _xI = _xH[2];var _xJ = E(_xI);return _xJ;};var _xK = I(2);var _xL = function(_xM,_xN,_xO){while(1){var _xP = _xE(_xN,_xK);var _xQ = _uS(_xP,_jS);if(_xQ){var _xR = _x9(_xN,_xK);var _xS = _7S(_xM,_xM);_xM=_xS;_xN=_xR;_xO=_xO;continue;var _xT = die("Unreachable!");var _xU = _xT;}else{var _xV = _uS(_xN,_jW);if(_xV){var _xW = _7S(_xM,_xO);}else{var _xX = _7S(_xM,_xO);var _xY = _xz(_xN,_jW);var _xZ = _x9(_xY,_xK);var _y0 = _7S(_xM,_xM);_xM=_y0;_xN=_xZ;_xO=_xX;continue;var _y1 = die("Unreachable!");var _xW = _y1;}var _xU = _xW;}return _xU;}};var _y2 = function(_y3,_y4){while(1){var _y5 = _xE(_y4,_xK);var _y6 = _uS(_y5,_jS);if(_y6){var _y7 = _x9(_y4,_xK);var _y8 = _7S(_y3,_y3);_y3=_y8;_y4=_y7;continue;var _y9 = die("Unreachable!");var _ya = _y9;}else{var _yb = _uS(_y4,_jW);if(_yb){var _yc = E(_y3);}else{var _yd = _xz(_y4,_jW);var _ye = _x9(_yd,_xK);var _yf = _7S(_y3,_y3);var _yg = _xL(_yf,_ye,_y3);var _yc = _yg;}var _ya = _yc;}return _ya;}};var _yh = function(_yi,_yj){var _yk = _xt(_yj,_jS);if(_yk){var _yl = E(_xy);}else{var _ym = _uS(_yj,_jS);var _yl = _ym?E(_jW):_y2(_yi,_yj);}return _yl;};var _yn = I(1);var _yo = function(_yp,_yq,_yr){while(1){var _ys = E(_yr);if(_ys[0]==1){var _yt = _xt(_yp,_3Y);if(_yt){var _yu = _3C(_yp);var _yv = _yh(_8v,_yu);var _yw = _tA(_yv);var _yx = _tL(_yv);var _yy = _7S(_yq,_yx);var _yz = _xh(_yy,_yw);var _yA = _yz;}else{var _yB = _yh(_8v,_yp);var _yC = _7S(_yq,_yB);var _yD = [1,_yC,_jW];var _yA = _yD;}var _yE = _yA;}else{var _yF = _ys[1];var _yG = _ys[2];var _yH = _xz(_yp,_yn);var _yI = E(_yF);var _yJ = _yI[1];var _yK = _3O(_yJ);var _yL = _7S(_yq,_8v);var _yM = _6w(_yL,_yK);_yp=_yH;_yq=_yM;_yr=_yG;continue;var _yN = die("Unreachable!");var _yE = _yN;}return _yE;}};var _yO = function(_yP){var _yQ = T(function(){var _yR = function(_yS){var _yT = [2,_yS];return A(_yP,[_yT]);};return _h3(_kH,_yR);});var _yU = function(_yV){var _yW = E(_yV);var _yX = _yW[1];var _yY = E(_yX);var _yZ = _yY=='.'?E(_yQ):[3];return _yZ;};return [1,_yU];};var _z0 = function(_z1){return A(_z1,[_2P]);};var _z2 = T(function(){return _3O(10);});var _z3 = function(_z4){var _z5 = T(function(){var _z6 = T(function(){var _z7 = function(_z8){var _z9 = T(function(){return _8h(_z2,_3Y,_z8);});var _za = [2,_z9];return A(_z4,[_za]);};return _h3(_kH,_z7);});var _zb = function(_zc){var _zd = E(_zc);var _ze = _zd[1];var _zf = E(_ze);if(_zf=='+'){var _zg = function(_zh){var _zi = T(function(){return _8h(_z2,_3Y,_zh);});var _zj = [2,_zi];return A(_z4,[_zj]);};var _zk = _h3(_kH,_zg);}else{var _zk = [3];}return _zk;};var _zl = [1,_zb];var _zm = function(_zn){var _zo = E(_zn);var _zp = _zo[1];var _zq = E(_zp);if(_zq=='-'){var _zr = function(_zs){var _zt = T(function(){var _zu = _8h(_z2,_3Y,_zs);var _zv = _3C(_zu);return _zv;});var _zw = [2,_zt];return A(_z4,[_zw]);};var _zx = _h3(_kH,_zr);}else{var _zx = [3];}return _zx;};var _zy = [1,_zm];var _zz = _dj(_zy,_zl);var _zA = _dj(_zz,_z6);return _zA;});var _zB = function(_zC){var _zD = E(_zC);var _zE = _zD[1];var _zF = E(_zE);var _zG = _zF=='E'?E(_z5):[3];return _zG;};var _zH = [1,_zB];var _zI = function(_zJ){var _zK = E(_zJ);var _zL = _zK[1];var _zM = E(_zL);var _zN = _zM=='e'?E(_z5):[3];return _zN;};var _zO = [1,_zI];return _dj(_zO,_zH);};var _zP = function(_zQ){return A(_zQ,[_2P]);};var _zR = function(_zS){var _zT = function(_zU){var _zV = T(function(){return _8h(_8v,_3Y,_zU);});var _zW = [6,_zV];var _zX = function(_zY){var _zZ = function(_A0){var _A1 = T(function(){var _A2 = E(_zY);if(_A2[0]==1){var _A3 = E(_A0);if(_A3[0]==1){var _A4 = E(_zW);}else{var _A5 = _A3[1];var _A6 = _tF(_A5,_3Y);if(_A6){var _A7 = T(function(){var _A8 = _yh(_8v,_A5);var _A9 = _7S(_zV,_A8);return _A9;});var _Aa = [6,_A7];}else{var _Ab = T(function(){var _Ac = _3C(_A5);var _Ad = _yh(_8v,_Ac);var _Ae = _tA(_Ad);var _Af = _tL(_Ad);var _Ag = _7S(_zV,_Af);var _Ah = _xh(_Ag,_Ae);var _Ai = _Ah[1];var _Aj = _Ah[2];var _Ak = [1,E(_Ai),E(_Aj)];return _Ak;});var _Aa = [7,_Ab];}var _A4 = _Aa;}var _Al = _A4;}else{var _Am = _A2[1];var _An = T(function(){var _Ao = E(_A0);if(_Ao[0]==1){var _Ap = _yo(_3Y,_zV,_Am);var _Aq = _Ap[1];var _Ar = _Ap[2];var _As = [1,E(_Aq),E(_Ar)];var _At = _As;}else{var _Au = _Ao[1];var _Av = _yo(_Au,_zV,_Am);var _Aw = _Av[1];var _Ax = _Av[2];var _Ay = [1,E(_Aw),E(_Ax)];var _At = _Ay;}return _At;});var _Al = [7,_An];}return _Al;});return A(_zS,[_A1]);};return _fs(_z3,_z0,_zZ);};return _fs(_yO,_zP,_zX);};return _h3(_kH,_zT);};var _Az = T(function(){return unCStr(",;()[]{}`");});var _AA = [1,'@'];var _AB = [2,_AA,_y];var _AC = [1,'~'];var _AD = [2,_AC,_y];var _AE = T(function(){return unCStr("=>");});var _AF = [2,_AE,_y];var _AG = [2,_AD,_AF];var _AH = [2,_AB,_AG];var _AI = T(function(){return unCStr("->");});var _AJ = [2,_AI,_AH];var _AK = T(function(){return unCStr("<-");});var _AL = [2,_AK,_AJ];var _AM = [1,'|'];var _AN = [2,_AM,_y];var _AO = [2,_AN,_AL];var _AP = [2,_pv,_y];var _AQ = [2,_AP,_AO];var _AR = [1,'='];var _AS = [2,_AR,_y];var _AT = [2,_AS,_AQ];var _AU = T(function(){return unCStr("::");});var _AV = [2,_AU,_AT];var _AW = T(function(){return unCStr("..");});var _AX = [2,_AW,_AV];var _AY = function(_AZ){var _B0 = T(function(){return A(_AZ,[_gm]);});var _B1 = T(function(){var _B2 = T(function(){var _B3 = function(_B4,_B5){var _B6 = T(function(){var _B7 = [1,_B4];return A(_AZ,[_B7]);});var _B8 = E(_B5);if(_B8){var _B9 = function(_Ba){var _Bb = E(_Ba);var _Bc = _Bb[1];var _Bd = E(_Bc);var _Be = _Bd=='\''?E(_B6):[3];return _Be;};var _Bf = [1,_B9];}else{var _Bg = E(_B4);var _Bh = _Bg[1];var _Bi = E(_Bh);if(_Bi=='\''){var _Bj = [3];}else{var _Bk = function(_Bl){var _Bm = E(_Bl);var _Bn = _Bm[1];var _Bo = E(_Bn);var _Bp = _Bo=='\''?E(_B6):[3];return _Bp;};var _Bj = [1,_Bk];}var _Bf = _Bj;}return _Bf;};var _Bq = function(_Br){var _Bs = E(_Br);var _Bt = _Bs[1];var _Bu = _Bs[2];var _Bv = _B3(_Bt,_Bu);return _Bv;};return _r2(_Bq);});var _Bw = function(_Bx){var _By = E(_Bx);var _Bz = _By[1];var _BA = E(_Bz);switch(_BA){case '\'':var _BB = [3];break;case '\\':var _BB = E(_B2);break;default:var _BC = T(function(){var _BD = [1,_By];return A(_AZ,[_BD]);});var _BE = function(_BF){var _BG = E(_BF);var _BH = _BG[1];var _BI = E(_BH);var _BJ = _BI=='\''?E(_BC):[3];return _BJ;};var _BB = [1,_BE];}return _BB;};var _BK = [1,_Bw];var _BL = T(function(){var _BM = T(function(){return _td(_a8,_AZ);});var _BN = T(function(){var _BO = T(function(){var _BP = T(function(){var _BQ = T(function(){return _fs(_iQ,_zR,_AZ);});var _BR = _fs(_jZ,_gB,_AZ);var _BS = _dj(_BR,_BQ);return _BS;});var _BT = function(_BU){var _BV = _aT(_aq,_BU,_gW);if(_BV){var _BW = function(_BX){var _BY = [2,_BU,_BX];var _BZ = _aT(_aN,_BY,_AX);if(_BZ){var _C0 = [3,_BY];var _C1 = A(_AZ,[_C0]);}else{var _C2 = [5,_BY];var _C1 = A(_AZ,[_C2]);}return _C1;};var _C3 = _g0(_gX,_BW);}else{var _C3 = [3];}return _C3;};var _C4 = [1,_BT];return _dj(_C4,_BP);});var _C5 = function(_C6){var _C7 = _aT(_aq,_C6,_Az);if(_C7){var _C8 = [2,_C6,_y];var _C9 = [3,_C8];var _Ca = A(_AZ,[_C9]);}else{var _Ca = [3];}return _Ca;};var _Cb = [1,_C5];return _dj(_Cb,_BO);});var _Cc = function(_Cd){var _Ce = E(_Cd);var _Cf = _Ce[1];var _Cg = E(_Cf);var _Ch = _Cg=='"'?E(_BM):[3];return _Ch;};var _Ci = [1,_Cc];return _dj(_Ci,_BN);});var _Cj = function(_Ck){var _Cl = E(_Ck);var _Cm = _Cl[1];var _Cn = E(_Cm);var _Co = _Cn=='\''?E(_BK):[3];return _Co;};var _Cp = [1,_Cj];return _dj(_Cp,_BL);});var _Cq = function(_Cr){var _Cs = E(_Cr);return _Cs[0]==1?E(_B0):[3];};var _Ct = [2,_Cq];return _dj(_Ct,_B1);};var _Cu = function(_Cv){var _Cw = T(function(){return _AY(_Cv);});var _Cx = function(_Cy){return E(_Cw);};var _Cz = function(_CA){return A(_97,[_CA,_Cx]);};return [2,_Cz];};var _CB = function(_CC,_CD){var _CE = T(function(){var _CF = function(_CG){var _CH = T(function(){return A(_CD,[_CG]);});var _CI = function(_CJ){var _CK = E(_CJ);if(_CK[0]==3){var _CL = _CK[1];var _CM = E(_CL);if(_CM[0]==1){var _CN = [3];}else{var _CO = _CM[1];var _CP = _CM[2];var _CQ = E(_CO);var _CR = _CQ[1];var _CS = E(_CR);if(_CS==')'){var _CT = E(_CP);var _CU = _CT[0]==1?E(_CH):[3];}else{var _CU = [3];}var _CN = _CU;}var _CV = _CN;}else{var _CV = [3];}return _CV;};return _Cu(_CI);};return A(_CC,[_93,_CF]);});var _CW = function(_CX){var _CY = E(_CX);if(_CY[0]==3){var _CZ = _CY[1];var _D0 = E(_CZ);if(_D0[0]==1){var _D1 = [3];}else{var _D2 = _D0[1];var _D3 = _D0[2];var _D4 = E(_D2);var _D5 = _D4[1];var _D6 = E(_D5);if(_D6=='('){var _D7 = E(_D3);var _D8 = _D7[0]==1?E(_CE):[3];}else{var _D8 = [3];}var _D1 = _D8;}var _D9 = _D1;}else{var _D9 = [3];}return _D9;};return _Cu(_CW);};var _Da = function(_Db){var _Dc = T(function(){var _Dd = function(_De){var _Df = [1,_h0,_De];return A(_Db,[_Df]);};return _h3(_h0,_Dd);});var _Dg = T(function(){var _Dh = function(_Di){var _Dj = [1,_gZ,_Di];return A(_Db,[_Dj]);};return _h3(_gZ,_Dh);});var _Dk = T(function(){var _Dl = function(_Dm){var _Dn = [1,_h0,_Dm];return A(_Db,[_Dn]);};return _h3(_h0,_Dl);});var _Do = T(function(){var _Dp = function(_Dq){var _Dr = [1,_gZ,_Dq];return A(_Db,[_Dr]);};return _h3(_gZ,_Dp);});var _Ds = function(_Dt){var _Du = E(_Dt);var _Dv = _Du[1];var _Dw = E(_Dv);switch(_Dw){case 'O':var _Dx = E(_Do);break;case 'X':var _Dx = E(_Dk);break;case 'o':var _Dx = E(_Dg);break;case 'x':var _Dx = E(_Dc);break;default:var _Dx = [3];}return _Dx;};var _Dy = [1,_Ds];var _Dz = function(_DA){var _DB = E(_DA);var _DC = _DB[1];var _DD = E(_DC);var _DE = _DD=='0'?E(_Dy):[3];return _DE;};return [1,_Dz];};var _DF = function(_DG){var _DH = function(_DI){var _DJ = function(_DK){var _DL = function(_DM){var _DN = [2,_DI,_DK,_DM];return A(_DG,[_DN]);};return _fs(_z3,_z0,_DL);};return _fs(_yO,_zP,_DJ);};return _h3(_kH,_DH);};var _DO = function(_DP){return _aT(_aq,_DP,_gW);};var _DQ = function(_DR){var _DS = _DR.charCodeAt(0);var _DT = u_iswalnum(_DS,realWorld);var _DU = _DT[2];var _DV = E(_DU);if(_DV){var _DW = true;}else{var _DX = [1,_DR];var _DW = _aT(_aq,_DX,_gn);}return _DW;};var _DY = function(_DZ){var _E0 = E(_DZ);var _E1 = _E0[1];var _E2 = _DQ(_E1);return _E2;};var _E3 = [2,_AE,_y];var _E4 = [2,_AC,_y];var _E5 = [2,_E4,_E3];var _E6 = [2,_AA,_y];var _E7 = [2,_E6,_E5];var _E8 = [2,_AI,_E7];var _E9 = [2,_AK,_E8];var _Ea = [2,_AM,_y];var _Eb = [2,_Ea,_E9];var _Ec = [2,_pv,_y];var _Ed = [2,_Ec,_Eb];var _Ee = [2,_AR,_y];var _Ef = [2,_Ee,_Ed];var _Eg = [2,_AU,_Ef];var _Eh = [2,_AW,_Eg];var _Ei = function(_Ej){var _Ek = T(function(){var _El = T(function(){var _Em = T(function(){var _En = function(_Eo){var _Ep = [4,_Eo];return A(_Ej,[_Ep]);};return _fs(_Da,_DF,_En);});var _Eq = function(_Er){var _Es = E(_Er);var _Et = _Es[1];var _Eu = _Et.charCodeAt(0);var _Ev = u_iswalpha(_Eu,realWorld);var _Ew = _Ev[2];var _Ex = E(_Ew);if(_Ex){var _Ey = function(_Ez){var _EA = [2,_Es,_Ez];var _EB = [1,_EA];return A(_Ej,[_EB]);};var _EC = _g0(_DY,_Ey);}else{var _ED = E(_Et);if(_ED=='_'){var _EE = function(_EF){var _EG = [2,_Es,_EF];var _EH = [1,_EG];return A(_Ej,[_EH]);};var _EI = _g0(_DY,_EE);}else{var _EI = [3];}var _EC = _EI;}return _EC;};var _EJ = [1,_Eq];return _dj(_EJ,_Em);});var _EK = function(_EL){var _EM = _aT(_aq,_EL,_gW);if(_EM){var _EN = function(_EO){var _EP = [2,_EL,_EO];var _EQ = _aT(_aN,_EP,_Eh);if(_EQ){var _ER = [2,_EP];var _ES = A(_Ej,[_ER]);}else{var _ET = [3,_EP];var _ES = A(_Ej,[_ET]);}return _ES;};var _EU = _g0(_DO,_EN);}else{var _EU = [3];}return _EU;};var _EV = [1,_EK];return _dj(_EV,_El);});var _EW = function(_EX){return E(_Ek);};var _EY = function(_EZ){return A(_97,[_EZ,_EW]);};return [2,_EY];};var _F0 = function(_F1,_F2){var _F3 = T(function(){var _F4 = function(_F5){var _F6 = T(function(){var _F7 = E(_F5);var _F8 = _F7[1];var _F9 = -_F8;var _Fa = [1,_F9];return _Fa;});return A(_F2,[_F6]);};var _Fb = function(_Fc){return A(_8P,[_Fc,_F1,_F4]);};return _Ei(_Fb);});var _Fd = T(function(){return _CB(_F0,_F2);});var _Fe = function(_Ff){var _Fg = E(_Ff);switch(_Fg[0]){case 3:var _Fh = _Fg[1];var _Fi = E(_Fh);if(_Fi[0]==1){var _Fj = [3];}else{var _Fk = _Fi[1];var _Fl = _Fi[2];var _Fm = E(_Fk);var _Fn = _Fm[1];var _Fo = E(_Fn);if(_Fo=='-'){var _Fp = E(_Fl);var _Fq = _Fp[0]==1?E(_F3):[3];}else{var _Fq = [3];}var _Fj = _Fq;}var _Fr = _Fj;break;case 4:var _Fs = _Fg[1];var _Ft = _8w(_Fs);if(_Ft[0]==1){var _Fu = [3];}else{var _Fv = _Ft[1];var _Fw = T(function(){var _Fx = _3s(_Fv);var _Fy = [1,_Fx];return _Fy;});var _Fu = A(_F2,[_Fw]);}var _Fr = _Fu;break;default:var _Fr = [3];}return _Fr;};var _Fz = _Ei(_Fe);var _FA = _dj(_Fz,_Fd);return _FA;};var _FB = function(_FC,_FD){return _F0(_FC,_FD);};var _FE = [3,coercionToken];var _FF = "load";var _FG = [1,_FF];var _FH = "mousemove";var _FI = [1,_FH];var _FJ = "mouseover";var _FK = [1,_FJ];var _FL = "mouseout";var _FM = [1,_FL];var _FN = "click";var _FO = [1,_FN];var _FP = "dblclick";var _FQ = [1,_FP];var _FR = "mousedown";var _FS = [1,_FR];var _FT = "mouseup";var _FU = [1,_FT];var _FV = "keypress";var _FW = [1,_FV];var _FX = "keyup";var _FY = [1,_FX];var _FZ = "keydown";var _G0 = [1,_FZ];var _G1 = "unload";var _G2 = [1,_G1];var _G3 = "change";var _G4 = [1,_G3];var _G5 = "focus";var _G6 = [1,_G5];var _G7 = "blur";var _G8 = [1,_G7];var _G9 = function(_Ga,_Gb,_Gc,_Gd){var _Ge = [1,_Gc];var _Gf = _Ge[1];var _Gg = function(_Gh){var _Gi = E(_Gc);var _Gj = jsSetCB(_Ga,_Gh,_Gf,_Gd);var _Gk = _Gj[1];var _Gl = _Gj[2];var _Gm = T(function(){var _Gn = E(_Gl);return _Gn?true:false;});var _Go = [1,_Gk,_Gm];return _Go;};var _Gp = E(_Gb);switch(_Gp[0]){case 1:var _Gq = E(_FG);var _Gr = _Gq[1];var _Gs = _Gg(_Gr);var _Gt = _Gs;break;case 2:var _Gu = E(_G2);var _Gv = _Gu[1];var _Gw = _Gg(_Gv);var _Gt = _Gw;break;case 3:var _Gx = E(_G4);var _Gy = _Gx[1];var _Gz = _Gg(_Gy);var _Gt = _Gz;break;case 4:var _GA = E(_G6);var _GB = _GA[1];var _GC = _Gg(_GB);var _Gt = _GC;break;case 5:var _GD = E(_G8);var _GE = _GD[1];var _GF = _Gg(_GE);var _Gt = _GF;break;case 6:var _GG = E(_FI);var _GH = _GG[1];var _GI = _Gg(_GH);var _Gt = _GI;break;case 7:var _GJ = E(_FK);var _GK = _GJ[1];var _GL = _Gg(_GK);var _Gt = _GL;break;case 8:var _GM = E(_FM);var _GN = _GM[1];var _GO = _Gg(_GN);var _Gt = _GO;break;case 9:var _GP = E(_FO);var _GQ = _GP[1];var _GR = _Gg(_GQ);var _Gt = _GR;break;case 10:var _GS = E(_FQ);var _GT = _GS[1];var _GU = _Gg(_GT);var _Gt = _GU;break;case 11:var _GV = E(_FS);var _GW = _GV[1];var _GX = _Gg(_GW);var _Gt = _GX;break;case 12:var _GY = E(_FU);var _GZ = _GY[1];var _H0 = _Gg(_GZ);var _Gt = _H0;break;case 13:var _H1 = E(_FW);var _H2 = _H1[1];var _H3 = _Gg(_H2);var _Gt = _H3;break;case 14:var _H4 = E(_FY);var _H5 = _H4[1];var _H6 = _Gg(_H5);var _Gt = _H6;break;case 15:var _H7 = E(_G0);var _H8 = _H7[1];var _H9 = _Gg(_H8);var _Gt = _H9;break;}return _Gt;};var _Ha = [9,coercionToken];var _Hb = T(function(){return unCStr("Pattern match failure in do expression at Main.hs:99:23-28");});var _Hc = T(function(){return unCStr("Pattern match failure in do expression at Main.hs:113:17-22");});var _Hd = T(function(){return unCStr("Pattern match failure in do expression at Main.hs:66:36-48");});var _He = T(function(){return unCStr("Pattern match failure in do expression at Main.hs:57:34-46");});var _Hf = T(function(){return unCStr("Pattern match failure in do expression at Main.hs:56:34-44");});var _Hg = T(function(){return unCStr("Pattern match failure in do expression at Main.hs:82:27-39");});var _Hh = T(function(){return unCStr("input");});var _Hi = T(function(){return toJSStr(_Hh);});var _Hj = T(function(){return unCStr("controls");});var _Hk = T(function(){return toJSStr(_Hj);});var _Hl = T(function(){return unCStr("value");});var _Hm = T(function(){return toJSStr(_Hl);});var _Hn = T(function(){return unCStr("button");});var _Ho = T(function(){return toJSStr(_Hn);});var _Hp = T(function(){return unCStr("type");});var _Hq = T(function(){return toJSStr(_Hp);});var _Hr = function(_Hs,_Ht){var _Hu = E(_Hk);var _Hv = _Hu[1];var _Hw = jsFind(_Hv,_Ht);var _Hx = _Hw[1];var _Hy = _Hw[2];var _Hz = [1,_Hy];var _HA = _Hz[1];var _HB = E(_HA);if(_HB[0]==1){var _HC = _2Y(_Hg,_Hx);}else{var _HD = _HB[1];var _HE = E(_Hi);var _HF = _HE[1];var _HG = jsCreateElem(_HF,_Hx);var _HH = _HG[1];var _HI = _HG[2];var _HJ = E(_Hq);var _HK = _HJ[1];var _HL = E(_Ho);var _HM = _HL[1];var _HN = jsSet(_HI,_HK,_HM,_HH);var _HO = _HN[1];var _HP = E(_Hm);var _HQ = _HP[1];var _HR = toJSStr(_Hs);var _HS = _HR[1];var _HT = jsSet(_HI,_HQ,_HS,_HO);var _HU = _HT[1];var _HV = E(_HD);var _HW = _HV[1];var _HX = jsAppendChild(_HI,_HW,_HU);var _HY = _HX[1];var _HZ = [1,_HI];var _I0 = [1,_HY,_HZ];var _HC = _I0;}return _HC;};var _I1 = T(function(){return unCStr("Solve");});var _I2 = T(function(){return unCStr("Reset");});var _I3 = [1,0];var _I4 = T(function(){return unCStr("puzzle");});var _I5 = T(function(){return toJSStr(_I4);});var _I6 = T(function(){return toJSStr(_Hj);});var _I7 = T(function(){return toJSStr(_Hj);});var _I8 = T(function(){return toJSStr(_Hl);});var _I9 = [1,'i'];var _Ia = T(function(){return toJSStr(_Hl);});var _Ib = "No solution!";var _Ic = [1,_Ib];var _Id = function(_Ie,_If,_Ig,_Ih){var _Ii = E(_Ig);if(_Ii[0]==1){var _Ij = E(_If);}else{var _Ik = _Ii[1];var _Il = _Ii[2];var _Im = E(_Ih);if(_Im[0]==1){var _In = E(_If);}else{var _Io = _Im[1];var _Ip = _Im[2];var _Iq = T(function(){return _Id(_Ie,_If,_Il,_Ip);});var _In = A(_Ie,[_Ik,_Io,_Iq]);}var _Ij = _In;}return _Ij;};var _Ir = function(_Is,_It,_Iu){var _Iv = T(function(){var _Iw = E(_Is);var _Ix = _Iw[1];var _Iy = _Iw[2];var _Iz = E(_It);var _IA = _Iz[1];var _IB = E(_IA);var _IC = _IB?[1,_Iz,_Iy]:[2,_Ix,_Iy];return _IC;});return [2,_Iv,_Iu];};var _ID = function(_IE,_IF){return _Id(_Ir,_y,_IE,_IF);};var _IG = T(function(){return unCStr("minimum");});var _IH = T(function(){return unCStr(": empty list");});var _II = T(function(){return unCStr("Prelude.");});var _IJ = function(_IK){var _IL = T(function(){return _J(_IK,_IH);});var _IM = _J(_II,_IL);var _IN = err(_IM);return _IN;};var _IO = T(function(){return _IJ(_IG);});var _IP = T(function(){return unCStr("(Array.!): undefined array element");});var _IQ = T(function(){return err(_IP);});var _IR = T(function(){return unCStr("Negative range size");});var _IS = T(function(){return err(_IR);});var _IT = function(_IU){var _IV = A(_IU,[realWorld]);var _IW = _IV[2];var _IX = E(_IW);return _IX;};var _IY = [1,0];var _IZ = T(function(){return unCStr(" out of range ");});var _J0 = T(function(){return unCStr("}.index: Index ");});var _J1 = T(function(){return unCStr("Ix{");});var _J2 = [2,_q7,_y];var _J3 = [2,_q7,_J2];var _J4 = [1,0];var _J5 = T(function(){return unCStr("foldr1");});var _J6 = T(function(){return _IJ(_J5);});var _J7 = function(_J8,_J9){var _Ja = E(_J9);if(_Ja[0]==1){var _Jb = E(_J6);}else{var _Jc = _Ja[1];var _Jd = _Ja[2];var _Je = E(_Jd);if(_Je[0]==1){var _Jf = E(_Jc);}else{var _Jg = T(function(){return _J7(_J8,_Je);});var _Jf = A(_J8,[_Jc,_Jg]);}var _Jb = _Jf;}return _Jb;};var _Jh = function(_Ji,_Jj,_Jk){var _Jl = T(function(){return A(_Jj,[_Jk]);});var _Jm = [2,_21,_Jl];return A(_Ji,[_Jm]);};var _Jn = function(_Jo,_Jp,_Jq,_Jr,_Js){var _Jt = T(function(){var _Ju = T(function(){var _Jv = T(function(){var _Jw = T(function(){var _Jx = T(function(){var _Jy = T(function(){return A(_Js,[_J4,_Jr]);});var _Jz = [2,_Jy,_y];var _JA = T(function(){return A(_Js,[_J4,_Jq]);});var _JB = [2,_JA,_Jz];return A(_J7,[_Jh,_JB,_J3]);});var _JC = [2,_q8,_Jx];var _JD = [2,_q8,_JC];return _J(_IZ,_JD);});var _JE = [2,_q7,_Jw];return A(_Js,[_IY,_Jp,_JE]);});var _JF = [2,_q8,_Jv];return _J(_J0,_JF);});return _J(_Jo,_Ju);});var _JG = _J(_J1,_Jt);var _JH = err(_JG);return _JH;};var _JI = function(_JJ,_JK,_JL,_JM){var _JN = E(_JL);var _JO = _JN[1];var _JP = _JN[2];var _JQ = E(_JM);var _JR = _JQ[1];var _JS = _Jn(_JJ,_JK,_JO,_JP,_JR);return _JS;};var _JT = function(_JU,_JV,_JW,_JX){return _JI(_JX,_JW,_JV,_JU);};var _JY = function(_JZ){var _K0 = E(_JZ);var _K1 = _K0[1];var _K2 = _q9(0,_K1,_y);return _K2;};var _K3 = function(_K4,_K5){var _K6 = E(_K4);if(_K6[0]==1){var _K7 = unAppCStr("[]",_K5);}else{var _K8 = _K6[1];var _K9 = _K6[2];var _Ka = T(function(){var _Kb = E(_K8);var _Kc = _Kb[1];var _Kd = T(function(){var _Ke = [2,_22,_K5];var _Kf = function(_Kg){var _Kh = E(_Kg);if(_Kh[0]==1){var _Ki = E(_Ke);}else{var _Kj = _Kh[1];var _Kk = _Kh[2];var _Kl = T(function(){var _Km = E(_Kj);var _Kn = _Km[1];var _Ko = T(function(){return _Kf(_Kk);});var _Kp = _q9(0,_Kn,_Ko);return _Kp;});var _Ki = [2,_21,_Kl];}return _Ki;};return _Kf(_K9);});var _Kq = _q9(0,_Kc,_Kd);return _Kq;});var _K7 = [2,_23,_Ka];}return _K7;};var _Kr = function(_Ks,_Kt,_Ku){var _Kv = E(_Ks);var _Kw = _Kv[1];var _Kx = E(_Kt);var _Ky = _Kx[1];var _Kz = _q9(_Kw,_Ky,_Ku);return _Kz;};var _KA = [1,_Kr,_JY,_K3];var _KB = T(function(){return unCStr("Int");});var _KC = function(_KD,_KE,_KF){var _KG = [1,_KE,_KF];return _JT(_KA,_KG,_KD,_KB);};var _KH = function(_KI,_KJ,_KK,_KL,_KM){while(1){var r=(function(_KN,_KO,_KP,_KQ,_KR){var _KS = E(_KR);if(_KS[0]==1){var _KT = [1,_KN,_KO,_KP,_KQ];}else{var _KU = _KS[1];var _KV = _KS[2];var _KW = function(_KX){var _KY = newArr(_KP,_IQ,_KX);var _KZ = _KY[1];var _L0 = _KY[2];var _L1 = function(_L2,_L3){while(1){var _L4 = _L2==_KP;if(_L4){var _L5 = E(_L3);}else{var _L6 = [0,_KQ[_L2]];var _L7 = _L6[1];var _L8 = (_L0[_L2]=_L7);var _L9 = _L2+1;_L2=_L9;_L3=_L8;continue;var _La = die("Unreachable!");var _L5 = _La;}return _L5;}};var _Lb = _L1(0,_KZ);var _Lc = function(_Ld,_Le,_Lf){var _Lg = E(_KN);var _Lh = _Lg[1];var _Li = E(_KO);var _Lj = _Li[1];var _Lk = _Lh<=_Ld;if(_Lk){var _Ll = _Ld<=_Lj;if(_Ll){var _Lm = T(function(){var _Ln = E(_KU);if(_Ln[0]==1){var _Lo = _Ln[1];var _Lp = T(function(){var _Lq = _Ld-_Lh;var _Lr = [0,_KQ[_Lq]];var _Ls = _Lr[1];var _Lt = E(_Ls);return _Lt;});var _Lu = [2,_Lo,_Lp];}else{var _Lv = _Ld-_Lh;var _Lw = [0,_KQ[_Lv]];var _Lx = _Lw[1];var _Ly = E(_Lx);var _Lu = _Ly;}return _Lu;});var _Lz = _Ld-_Lh;var _LA = (_L0[_Lz]=_Lm);var _LB = A(_Le,[_LA]);var _LC = _LB;}else{var _LD = [1,_Ld];var _LC = _KC(_LD,_Lg,_Li);}var _LE = _LC;}else{var _LF = [1,_Ld];var _LE = _KC(_LF,_Lg,_Li);}return _LE;};var _LG = E(_KU);if(_LG[0]==1){var _LH = _LG[2];var _LI = function(_LJ,_LK){var _LL = E(_LJ);if(_LL[0]==1){var _LM = [0,0,_L0];var _LN = _LM[1];var _LO = _LM[2];var _LP = [1,E(_KN),E(_KO),_KP,_LO];var _LQ = [1,_LN,_LP];var _LR = _LQ;}else{var _LS = _LL[1];var _LT = _LL[2];var _LU = E(_LS);var _LV = _LU[1];var _LW = function(_LX){return _LI(_LT,_LX);};var _LY = _Lc(_LV,_LW,_LK);var _LR = _LY;}return _LR;};var _LZ = _LI(_LH,_Lb);}else{var _M0 = _LG[2];var _M1 = function(_M2,_M3){var _M4 = E(_M2);if(_M4[0]==1){var _M5 = [0,0,_L0];var _M6 = _M5[1];var _M7 = _M5[2];var _M8 = [1,E(_KN),E(_KO),_KP,_M7];var _M9 = [1,_M6,_M8];var _Ma = _M9;}else{var _Mb = _M4[1];var _Mc = _M4[2];var _Md = E(_Mb);var _Me = _Md[1];var _Mf = function(_LX){return _M1(_Mc,_LX);};var _Mg = _Lc(_Me,_Mf,_M3);var _Ma = _Mg;}return _Ma;};var _LZ = _M1(_M0,_Lb);}return _LZ;};var _Mh = _IT(_KW);var _Mi = _Mh[1];var _Mj = _Mh[2];var _Mk = _Mh[3];var _Ml = _Mh[4];_KI=_Mi;_KJ=_Mj;_KK=_Mk;_KL=_Ml;_KM=_KV;return null;var _Mm = die("Unreachable!");var _KT = _Mm;}return _KT;})(_KI,_KJ,_KK,_KL,_KM);if(null!==r)return r;}};var _Mn = function(_Mo,_Mp){while(1){var _Mq = E(_Mp);if(_Mq[0]==1){var _Mr = E(_Mo);}else{var _Ms = _Mq[1];var _Mt = _Mq[2];var _Mu = E(_Ms);var _Mv = _Mu[1];var _Mw = _Mo<=_Mv;if(_Mw){_Mo=_Mo;_Mp=_Mt;continue;var _Mx = die("Unreachable!");}else{_Mo=_Mv;_Mp=_Mt;continue;var _Mx = die("Unreachable!");}var _Mr = _Mx;}return _Mr;}};var _My = function(_Mz,_MA){while(1){var _MB = E(_MA);if(_MB[0]==1){var _MC = E(_Mz);}else{var _MD = _MB[1];var _ME = _MB[2];var _MF = E(_MD);var _MG = _MF[1];var _MH = _Mz<=_MG;if(_MH){_Mz=_MG;_MA=_ME;continue;var _MI = die("Unreachable!");}else{_Mz=_Mz;_MA=_ME;continue;var _MI = die("Unreachable!");}var _MC = _MI;}return _MC;}};var _MJ = function(_MK){var _ML = E(_MK);if(_ML[0]==1){var _MM = [1];}else{var _MN = _ML[1];var _MO = _ML[2];var _MP = E(_MN);if(_MP[0]==1){var _MQ = _MP[2];var _MR = T(function(){return _MJ(_MO);});var _MS = _J(_MQ,_MR);}else{var _MT = _MP[2];var _MU = T(function(){return _MJ(_MO);});var _MS = _J(_MT,_MU);}var _MM = _MS;}return _MM;};var _MV = function(_MW,_MX,_MY){var _MZ = [1,_MW];var _N0 = [1,_MX,_MY];return _JT(_KA,_N0,_MZ,_KB);};var _N1 = function(_N2){while(1){var r=(function(_N3){var _N4 = E(_N3);if(_N4[0]==1){var _N5 = [1];}else{var _N6 = _N4[1];var _N7 = _N4[2];var _N8 = E(_N6);if(_N8[0]==1){_N2=_N7;return null;var _N9 = die("Unreachable!");}else{var _Na = _N8[1];var _Nb = T(function(){return _N1(_N7);});var _N9 = [2,_Na,_Nb];}var _N5 = _N9;}return _N5;})(_N2);if(null!==r)return r;}};var _Nc = function(_Nd,_Ne){var _Nf = E(_Nd);var _Ng = _Nf[1];var _Nh = E(_Ne);var _Ni = _Nh[1];var _Nj = _Ng==_Ni;return _Nj;};var _Nk = function(_Nl,_Nm){var _Nn = E(_Nl);var _No = _Nn[1];var _Np = E(_Nm);var _Nq = _Np[1];var _Nr = _No!=_Nq;return _Nr;};var _Ns = [1,_Nc,_Nk];var _Nt = [2,_y];var _Nu = function(_Nv,_Nw,_Nx){var _Ny = [1,_Nw,_Nx];return _JT(_KA,_Ny,_Nv,_KB);};var _Nz = function(_NA,_NB,_NC){var _ND = [1,_NB,_NC];return _JT(_KA,_ND,_NA,_KB);};var _NE = function(_NF,_NG){var _NH = E(_NG);if(_NH[0]==1){var _NI = E(_Nt);}else{var _NJ = _NH[1];var _NK = _NH[2];var _NL = E(_NJ);if(_NL[0]==1){var _NM = _NL[1];var _NN = _NE(_NF,_NK);if(_NN[0]==1){var _NO = [1];}else{var _NP = _NN[1];var _NQ = [2,_NM,_NP];var _NO = [2,_NQ];}var _NR = _NO;}else{var _NS = _NL[1];var _NT = _NL[2];var _NU = function(_NV){while(1){var r=(function(_NW){var _NX = E(_NW);if(_NX[0]==1){var _NY = [1];}else{var _NZ = _NX[1];var _O0 = _NX[2];var _O1 = function(_O2){var _O3 = T(function(){return _NU(_O0);});var _O4 = T(function(){var _O5 = T(function(){var _O6 = E(_NF);var _O7 = _O6[1];var _O8 = _O6[2];var _O9 = _O6[3];var _Oa = _O6[4];var _Ob = E(_O7);var _Oc = _Ob[1];var _Od = E(_O8);var _Oe = _Od[1];var _Of = function(_Og){var _Oh = newArr(_O9,_IQ,_Og);var _Oi = _Oh[1];var _Oj = _Oh[2];var _Ok = function(_Ol,_Om){while(1){var _On = _Ol==_O9;if(_On){var _Oo = E(_Om);}else{var _Op = [0,_Oa[_Ol]];var _Oq = _Op[1];var _Or = (_Oj[_Ol]=_Oq);var _Os = _Ol+1;_Ol=_Os;_Om=_Or;continue;var _Ot = die("Unreachable!");var _Oo = _Ot;}return _Oo;}};var _Ou = _Ok(0,_Oi);var _Ov = function(_Ow,_Ox){while(1){var r=(function(_Oy,_Oz){var _OA = E(_Oy);if(_OA[0]==1){var _OB = [0,0,_Oj];var _OC = _OB[1];var _OD = _OB[2];var _OE = [1,E(_Ob),E(_Od),_O9,_OD];var _OF = [1,_OC,_OE];var _OG = _OF;}else{var _OH = _OA[1];var _OI = _OA[2];var _OJ = E(_OH);var _OK = _OJ[1];var _OL = _Oc<=_OK;if(_OL){var _OM = _OK<=_Oe;if(_OM){var _ON = T(function(){var _OO = _OK-_Oc;var _OP = [0,_Oa[_OO]];var _OQ = _OP[1];var _OR = E(_OQ);return _OR;});var _OS = [2,_NZ,_ON];var _OT = _OK-_Oc;var _OU = (_Oj[_OT]=_OS);_Ow=_OI;_Ox=_OU;return null;var _OV = die("Unreachable!");var _OW = _OV;}else{var _OW = _Nu(_OJ,_Ob,_Od);}var _OX = _OW;}else{var _OX = _Nu(_OJ,_Ob,_Od);}var _OG = _OX;}return _OG;})(_Ow,_Ox);if(null!==r)return r;}};var _OY = _Ov(_NT,_Ou);return _OY;};var _OZ = _IT(_Of);return _OZ;});var _P0 = _NE(_O5,_NK);if(_P0[0]==1){var _P1 = [1];}else{var _P2 = _P0[1];var _P3 = [2,_NZ,_P2];var _P1 = [2,_P3];}return _P1;});return [2,_O4,_O3];};var _P4 = E(_NT);if(_P4[0]==1){var _P5 = _O1(realWorld);}else{var _P6 = _P4[1];var _P7 = _P4[2];var _P8 = E(_NF);var _P9 = _P8[1];var _Pa = _P8[2];var _Pb = _P8[4];var _Pc = E(_P9);var _Pd = _Pc[1];var _Pe = E(_Pa);var _Pf = _Pe[1];var _Pg = E(_P6);var _Ph = _Pg[1];var _Pi = _Pd<=_Ph;if(_Pi){var _Pj = _Ph<=_Pf;if(_Pj){var _Pk = _Ph-_Pd;var _Pl = [0,_Pb[_Pk]];var _Pm = _Pl[1];var _Pn = _aT(_Ns,_NZ,_Pm);if(_Pn){_NV=_O0;return null;var _Po = die("Unreachable!");}else{var _Pp = function(_Pq){while(1){var _Pr = E(_Pq);if(_Pr[0]==1){var _Ps = false;}else{var _Pt = _Pr[1];var _Pu = _Pr[2];var _Pv = E(_Pt);var _Pw = _Pv[1];var _Px = _Pd<=_Pw;if(_Px){var _Py = _Pw<=_Pf;if(_Py){var _Pz = _Pw-_Pd;var _PA = [0,_Pb[_Pz]];var _PB = _PA[1];var _PC = _aT(_Ns,_NZ,_PB);if(_PC){var _PD = true;}else{_Pq=_Pu;continue;var _PD = die("Unreachable!");}var _PE = _PD;}else{var _PE = _Nz(_Pv,_Pc,_Pe);}var _PF = _PE;}else{var _PF = _Nz(_Pv,_Pc,_Pe);}var _Ps = _PF;}return _Ps;}};var _PG = _Pp(_P7);if(_PG){_NV=_O0;return null;var _PH = die("Unreachable!");}else{var _PH = _O1(realWorld);}var _Po = _PH;}var _PI = _Po;}else{var _PI = _Nz(_Pg,_Pc,_Pe);}var _PJ = _PI;}else{var _PJ = _Nz(_Pg,_Pc,_Pe);}var _P5 = _PJ;}var _NY = _P5;}return _NY;})(_NV);if(null!==r)return r;}};var _PK = _NU(_NS);var _PL = _N1(_PK);if(_PL[0]==1){var _PM = [1];}else{var _PN = _PL[1];var _PM = [2,_PN];}var _NR = _PM;}var _NI = _NR;}return _NI;};var _PO = function(_PP){var _PQ = T(function(){var _PR = _MJ(_PP);if(_PR[0]==1){var _PS = E(_IO);}else{var _PT = _PR[1];var _PU = _PR[2];var _PV = E(_PT);var _PW = _PV[1];var _PX = _Mn(_PW,_PU);var _PY = _My(_PW,_PU);var _PZ = function(_Q0){var _Q1 = _Q0<0;if(_Q1){var _Q2 = E(_IS);}else{var _Q3 = [1,_PY];var _Q4 = [1,_PX];var _Q5 = function(_Q6){var _Q7 = newArr(_Q0,_IQ,_Q6);var _Q8 = _Q7[1];var _Q9 = _Q7[2];var _Qa = _PX>_PY;if(_Qa){var _Qb = [0,0,_Q9];var _Qc = _Qb[1];var _Qd = _Qb[2];var _Qe = [1,E(_Q4),E(_Q3),_Q0,_Qd];var _Qf = [1,_Qc,_Qe];var _Qg = _Qf;}else{var _Qh = function(_Qi,_Qj){while(1){var _Qk = _PX<=_Qi;if(_Qk){var _Ql = _Qi<=_PY;if(_Ql){var _Qm = _Qi-_PX;var _Qn = (_Q9[_Qm]=_y);var _Qo = _Qi==_PY;if(_Qo){var _Qp = [0,0,_Q9];var _Qq = _Qp[1];var _Qr = _Qp[2];var _Qs = [1,E(_Q4),E(_Q3),_Q0,_Qr];var _Qt = [1,_Qq,_Qs];var _Qu = _Qt;}else{var _Qv = _Qi+1;_Qi=_Qv;_Qj=_Qn;continue;var _Qw = die("Unreachable!");var _Qu = _Qw;}var _Qx = _Qu;}else{var _Qx = _MV(_Qi,_Q4,_Q3);}var _Qy = _Qx;}else{var _Qy = _MV(_Qi,_Q4,_Q3);}return _Qy;}};var _Qg = _Qh(_PX,_Q8);}return _Qg;};var _Q2 = _IT(_Q5);}return _Q2;};var _Qz = _PX<=_PY;if(_Qz){var _QA = _PY-_PX;var _QB = _QA+1;var _QC = _PZ(_QB);var _QD = _QC[1];var _QE = _QC[2];var _QF = _QC[3];var _QG = _QC[4];var _QH = _KH(_QD,_QE,_QF,_QG,_PP);var _QI = _QH[1];var _QJ = _QH[2];var _QK = _QH[3];var _QL = _QH[4];var _QM = [1,E(_QI),E(_QJ),_QK,_QL];var _QN = _QM;}else{var _QO = _PZ(0);var _QP = _QO[1];var _QQ = _QO[2];var _QR = _QO[3];var _QS = _QO[4];var _QT = _KH(_QP,_QQ,_QR,_QS,_PP);var _QU = _QT[1];var _QV = _QT[2];var _QW = _QT[3];var _QX = _QT[4];var _QY = [1,E(_QU),E(_QV),_QW,_QX];var _QN = _QY;}var _PS = _QN;}return _PS;});return _NE(_PQ,_PP);};var _QZ = T(function(){return unCStr("Prelude.read: ambiguous parse");});var _R0 = T(function(){return err(_QZ);});var _R1 = T(function(){return unCStr("Prelude.read: no parse");});var _R2 = T(function(){return err(_R1);});var _R3 = function(_R4){var _R5 = [4,_R4,_ff];var _R6 = function(_R7){return E(_R5);};var _R8 = function(_R9){return A(_97,[_R9,_R6]);};return [2,_R8];};var _Ra = function(_Rb){while(1){var r=(function(_Rc){var _Rd = E(_Rc);if(_Rd[0]==1){var _Re = [1];}else{var _Rf = _Rd[1];var _Rg = _Rd[2];var _Rh = E(_Rf);var _Ri = _Rh[1];var _Rj = _Rh[2];var _Rk = E(_Rj);if(_Rk[0]==1){var _Rl = T(function(){return _Ra(_Rg);});var _Rm = [2,_Ri,_Rl];}else{_Rb=_Rg;return null;var _Rm = die("Unreachable!");}var _Re = _Rm;}return _Re;})(_Rb);if(null!==r)return r;}};var _Rn = function(_Ro,_Rp){var _Rq = A(_Ro,[_93,_R3]);var _Rr = _cX(_Rq,_Rp);var _Rs = _Ra(_Rr);if(_Rs[0]==1){var _Rt = E(_R2);}else{var _Ru = _Rs[1];var _Rv = _Rs[2];var _Rw = E(_Rv);var _Rt = _Rw[0]==1?E(_Ru):E(_R0);}return _Rt;};var _Rx = function(_Ry,_Rz,_RA,_RB){var _RC = E(_I5);var _RD = _RC[1];var _RE = jsFind(_RD,_RB);var _RF = _RE[1];var _RG = _RE[2];var _RH = [1,_RG];var _RI = _RH[1];var _RJ = E(_RI);if(_RJ[0]==1){var _RK = _2Y(_Hf,_RF);}else{var _RL = _RJ[1];var _RM = E(_I6);var _RN = _RM[1];var _RO = jsFind(_RN,_RF);var _RP = _RO[1];var _RQ = _RO[2];var _RR = [1,_RQ];var _RS = _RR[1];var _RT = E(_RS);if(_RT[0]==1){var _RU = _2Y(_He,_RP);}else{var _RV = E(_RL);var _RW = _RV[1];var _RX = jsClearChildren(_RW,_RP);var _RY = _RX[1];var _RZ = A(_RA,[_RV,_RY]);var _S0 = _RZ[1];var _S1 = E(_I7);var _S2 = _S1[1];var _S3 = jsFind(_S2,_S0);var _S4 = _S3[1];var _S5 = _S3[2];var _S6 = [1,_S5];var _S7 = _S6[1];var _S8 = E(_S7);if(_S8[0]==1){var _S9 = _2Y(_Hd,_S4);var _Sa = _S9[1];var _Sb = [1,_Sa,_94];var _Sc = _Sb;}else{var _Sd = _S8[1];var _Se = E(_Sd);var _Sf = _Se[1];var _Sg = jsClearChildren(_Sf,_S4);var _Sh = _Sg[1];var _Si = _Hr(_I1,_Sh);var _Sj = _Si[1];var _Sk = _Si[2];var _Sl = _Hr(_I2,_Sj);var _Sm = _Sl[1];var _Sn = _Sl[2];var _So = E(_Sk);var _Sp = _So[1];var _Sq = function(_Sr,_Ss){var _St = E(_Rz);var _Su = _St[1];var _Sv = function(_Sw,_Sx){var _Sy = _ID(_Ry,_Sx);var _Sz = _PO(_Sy);if(_Sz[0]==1){var _SA = E(_Ic);var _SB = _SA[1];var _SC = jsAlert(_SB,_Sw);var _SD = _SC[1];var _SE = [1,_SD,_94];var _SF = _SE;}else{var _SG = _Sz[1];var _SH = 1>_Su;if(_SH){var _SI = [1,_Sw,_94];}else{var _SJ = function(_SK,_SL,_SM){while(1){var r=(function(_SN,_SO,_SP){var _SQ = E(_SO);if(_SQ[0]==1){var _SR = [1,_SP,_94];}else{var _SS = _SQ[1];var _ST = _SQ[2];var _SU = T(function(){var _SV = jsShowI(_SN,realWorld);var _SW = _SV[2];var _SX = [1,_SW];var _SY = fromJSStr(_SX);return _SY;});var _SZ = [2,_I9,_SU];var _T0 = toJSStr(_SZ);var _T1 = _T0[1];var _T2 = jsFind(_T1,_SP);var _T3 = _T2[1];var _T4 = _T2[2];var _T5 = [1,_T4];var _T6 = _T5[1];var _T7 = E(_T6);if(_T7[0]==1){var _T8 = _2Y(_Hb,_T3);var _T9 = _T8[1];var _Ta = _SN==_Su;if(_Ta){var _Tb = [1,_T9,_94];}else{var _Tc = _SN+1;_SK=_Tc;_SL=_ST;_SM=_T9;return null;var _Td = die("Unreachable!");var _Tb = _Td;}var _Te = _Tb;}else{var _Tf = _T7[1];var _Tg = E(_SS);var _Th = _Tg[1];var _Ti = jsShowI(_Th,realWorld);var _Tj = _Ti[2];var _Tk = E(_Tf);var _Tl = _Tk[1];var _Tm = E(_Ia);var _Tn = _Tm[1];var _To = jsSet(_Tl,_Tn,_Tj,_T3);var _Tp = _To[1];var _Tq = _SN==_Su;if(_Tq){var _Tr = [1,_Tp,_94];}else{var _Ts = function(_Tt,_Tu,_Tv){while(1){var r=(function(_Tw,_Tx,_Ty){var _Tz = E(_Tx);if(_Tz[0]==1){var _TA = [1,_Ty,_94];}else{var _TB = _Tz[1];var _TC = _Tz[2];var _TD = T(function(){var _TE = jsShowI(_Tw,realWorld);var _TF = _TE[2];var _TG = [1,_TF];var _TH = fromJSStr(_TG);return _TH;});var _TI = [2,_I9,_TD];var _TJ = toJSStr(_TI);var _TK = _TJ[1];var _TL = jsFind(_TK,_Ty);var _TM = _TL[1];var _TN = _TL[2];var _TO = [1,_TN];var _TP = _TO[1];var _TQ = E(_TP);if(_TQ[0]==1){var _TR = _2Y(_Hb,_TM);var _TS = _TR[1];var _TT = _Tw==_Su;if(_TT){var _TU = [1,_TS,_94];}else{var _TV = _Tw+1;_Tt=_TV;_Tu=_TC;_Tv=_TS;return null;var _TW = die("Unreachable!");var _TU = _TW;}var _TX = _TU;}else{var _TY = _TQ[1];var _TZ = E(_TB);var _U0 = _TZ[1];var _U1 = jsShowI(_U0,realWorld);var _U2 = _U1[2];var _U3 = E(_TY);var _U4 = _U3[1];var _U5 = jsSet(_U4,_Tn,_U2,_TM);var _U6 = _U5[1];var _U7 = _Tw==_Su;if(_U7){var _U8 = [1,_U6,_94];}else{var _U9 = _Tw+1;_Tt=_U9;_Tu=_TC;_Tv=_U6;return null;var _Ua = die("Unreachable!");var _U8 = _Ua;}var _TX = _U8;}var _TA = _TX;}return _TA;})(_Tt,_Tu,_Tv);if(null!==r)return r;}};var _Ub = _SN+1;var _Uc = _Ts(_Ub,_ST,_Tp);var _Tr = _Uc;}var _Te = _Tr;}var _SR = _Te;}return _SR;})(_SK,_SL,_SM);if(null!==r)return r;}};var _SI = _SJ(1,_SG,_Sw);}var _SF = _SI;}return _SF;};var _Ud = 1>_Su;if(_Ud){var _Ue = _Sv(_Ss,_y);}else{var _Uf = function(_Ug,_Uh){var _Ui = T(function(){var _Uj = jsShowI(_Ug,realWorld);var _Uk = _Uj[2];var _Ul = [1,_Uk];var _Um = fromJSStr(_Ul);return _Um;});var _Un = [2,_I9,_Ui];var _Uo = toJSStr(_Un);var _Up = _Uo[1];var _Uq = jsFind(_Up,_Uh);var _Ur = _Uq[1];var _Us = _Uq[2];var _Ut = [1,_Us];var _Uu = _Ut[1];var _Uv = E(_Uu);if(_Uv[0]==1){var _Uw = _2Y(_Hc,_Ur);var _Ux = _Uw[1];var _Uy = _Uw[2];var _Uz = _Ug==_Su;if(_Uz){var _UA = [2,_Uy,_y];var _UB = [1,_Ux,_UA];}else{var _UC = _Ug+1;var _UD = _Uf(_UC,_Ux);var _UE = _UD[1];var _UF = _UD[2];var _UG = [2,_Uy,_UF];var _UH = [1,_UE,_UG];var _UB = _UH;}var _UI = _UB;}else{var _UJ = _Uv[1];var _UK = E(_UJ);var _UL = _UK[1];var _UM = E(_I8);var _UN = _UM[1];var _UO = jsGet(_UL,_UN,_Ur);var _UP = _UO[1];var _UQ = _UO[2];var _UR = T(function(){var _US = [1,_UQ];var _UT = fromJSStr(_US);return _UT[0]==1?E(_I3):_Rn(_FB,_UT);});var _UU = _Ug==_Su;if(_UU){var _UV = [2,_UR,_y];var _UW = [1,_UP,_UV];}else{var _UX = function(_UY,_UZ){var _V0 = T(function(){var _V1 = jsShowI(_UY,realWorld);var _V2 = _V1[2];var _V3 = [1,_V2];var _V4 = fromJSStr(_V3);return _V4;});var _V5 = [2,_I9,_V0];var _V6 = toJSStr(_V5);var _V7 = _V6[1];var _V8 = jsFind(_V7,_UZ);var _V9 = _V8[1];var _Va = _V8[2];var _Vb = [1,_Va];var _Vc = _Vb[1];var _Vd = E(_Vc);if(_Vd[0]==1){var _Ve = _2Y(_Hc,_V9);var _Vf = _Ve[1];var _Vg = _Ve[2];var _Vh = _UY==_Su;if(_Vh){var _Vi = [2,_Vg,_y];var _Vj = [1,_Vf,_Vi];}else{var _Vk = _UY+1;var _Vl = _UX(_Vk,_Vf);var _Vm = _Vl[1];var _Vn = _Vl[2];var _Vo = [2,_Vg,_Vn];var _Vp = [1,_Vm,_Vo];var _Vj = _Vp;}var _Vq = _Vj;}else{var _Vr = _Vd[1];var _Vs = E(_Vr);var _Vt = _Vs[1];var _Vu = jsGet(_Vt,_UN,_V9);var _Vv = _Vu[1];var _Vw = _Vu[2];var _Vx = T(function(){var _Vy = [1,_Vw];var _Vz = fromJSStr(_Vy);return _Vz[0]==1?E(_I3):_Rn(_FB,_Vz);});var _VA = _UY==_Su;if(_VA){var _VB = [2,_Vx,_y];var _VC = [1,_Vv,_VB];}else{var _VD = _UY+1;var _VE = _UX(_VD,_Vv);var _VF = _VE[1];var _VG = _VE[2];var _VH = [2,_Vx,_VG];var _VI = [1,_VF,_VH];var _VC = _VI;}var _Vq = _VC;}return _Vq;};var _VJ = _Ug+1;var _VK = _UX(_VJ,_UP);var _VL = _VK[1];var _VM = _VK[2];var _VN = [2,_UR,_VM];var _VO = [1,_VL,_VN];var _UW = _VO;}var _UI = _UW;}return _UI;};var _VP = _Uf(1,_Ss);var _VQ = _VP[1];var _VR = _VP[2];var _VS = _Sv(_VQ,_VR);var _Ue = _VS;}return _Ue;};var _VT = _G9(_Sp,_Ha,_Sq,_Sm);var _VU = _VT[1];var _VV = E(_Sn);var _VW = _VV[1];var _VX = function(_VY){var _VZ = function(_W0,_W1,_W2,_W3){var _W4 = jsFind(_RD,_W3);var _W5 = _W4[1];var _W6 = _W4[2];var _W7 = [1,_W6];var _W8 = _W7[1];var _W9 = E(_W8);if(_W9[0]==1){var _Wa = _2Y(_Hf,_W5);}else{var _Wb = _W9[1];var _Wc = jsFind(_RN,_W5);var _Wd = _Wc[1];var _We = _Wc[2];var _Wf = [1,_We];var _Wg = _Wf[1];var _Wh = E(_Wg);if(_Wh[0]==1){var _Wi = _2Y(_He,_Wd);}else{var _Wj = E(_Wb);var _Wk = _Wj[1];var _Wl = jsClearChildren(_Wk,_Wd);var _Wm = _Wl[1];var _Wn = A(_W2,[_Wj,_Wm]);var _Wo = _Wn[1];var _Wp = jsFind(_S2,_Wo);var _Wq = _Wp[1];var _Wr = _Wp[2];var _Ws = [1,_Wr];var _Wt = _Ws[1];var _Wu = E(_Wt);if(_Wu[0]==1){var _Wv = _2Y(_Hd,_Wq);var _Ww = _Wv[1];var _Wx = [1,_Ww,_94];var _Wy = _Wx;}else{var _Wz = _Wu[1];var _WA = E(_Wz);var _WB = _WA[1];var _WC = jsClearChildren(_WB,_Wq);var _WD = _WC[1];var _WE = _Hr(_I1,_WD);var _WF = _WE[1];var _WG = _WE[2];var _WH = _Hr(_I2,_WF);var _WI = _WH[1];var _WJ = _WH[2];var _WK = E(_WG);var _WL = _WK[1];var _WM = function(_WN,_WO){var _WP = E(_W1);var _WQ = _WP[1];var _WR = function(_WS,_WT){var _WU = _ID(_W0,_WT);var _WV = _PO(_WU);if(_WV[0]==1){var _WW = E(_Ic);var _WX = _WW[1];var _WY = jsAlert(_WX,_WS);var _WZ = _WY[1];var _X0 = [1,_WZ,_94];var _X1 = _X0;}else{var _X2 = _WV[1];var _X3 = 1>_WQ;if(_X3){var _X4 = [1,_WS,_94];}else{var _X5 = function(_X6,_X7,_X8){while(1){var r=(function(_X9,_Xa,_Xb){var _Xc = E(_Xa);if(_Xc[0]==1){var _Xd = [1,_Xb,_94];}else{var _Xe = _Xc[1];var _Xf = _Xc[2];var _Xg = T(function(){var _Xh = jsShowI(_X9,realWorld);var _Xi = _Xh[2];var _Xj = [1,_Xi];var _Xk = fromJSStr(_Xj);return _Xk;});var _Xl = [2,_I9,_Xg];var _Xm = toJSStr(_Xl);var _Xn = _Xm[1];var _Xo = jsFind(_Xn,_Xb);var _Xp = _Xo[1];var _Xq = _Xo[2];var _Xr = [1,_Xq];var _Xs = _Xr[1];var _Xt = E(_Xs);if(_Xt[0]==1){var _Xu = _2Y(_Hb,_Xp);var _Xv = _Xu[1];var _Xw = _X9==_WQ;if(_Xw){var _Xx = [1,_Xv,_94];}else{var _Xy = _X9+1;_X6=_Xy;_X7=_Xf;_X8=_Xv;return null;var _Xz = die("Unreachable!");var _Xx = _Xz;}var _XA = _Xx;}else{var _XB = _Xt[1];var _XC = E(_Xe);var _XD = _XC[1];var _XE = jsShowI(_XD,realWorld);var _XF = _XE[2];var _XG = E(_XB);var _XH = _XG[1];var _XI = E(_Ia);var _XJ = _XI[1];var _XK = jsSet(_XH,_XJ,_XF,_Xp);var _XL = _XK[1];var _XM = _X9==_WQ;if(_XM){var _XN = [1,_XL,_94];}else{var _XO = function(_XP,_XQ,_XR){while(1){var r=(function(_XS,_XT,_XU){var _XV = E(_XT);if(_XV[0]==1){var _XW = [1,_XU,_94];}else{var _XX = _XV[1];var _XY = _XV[2];var _XZ = T(function(){var _Y0 = jsShowI(_XS,realWorld);var _Y1 = _Y0[2];var _Y2 = [1,_Y1];var _Y3 = fromJSStr(_Y2);return _Y3;});var _Y4 = [2,_I9,_XZ];var _Y5 = toJSStr(_Y4);var _Y6 = _Y5[1];var _Y7 = jsFind(_Y6,_XU);var _Y8 = _Y7[1];var _Y9 = _Y7[2];var _Ya = [1,_Y9];var _Yb = _Ya[1];var _Yc = E(_Yb);if(_Yc[0]==1){var _Yd = _2Y(_Hb,_Y8);var _Ye = _Yd[1];var _Yf = _XS==_WQ;if(_Yf){var _Yg = [1,_Ye,_94];}else{var _Yh = _XS+1;_XP=_Yh;_XQ=_XY;_XR=_Ye;return null;var _Yi = die("Unreachable!");var _Yg = _Yi;}var _Yj = _Yg;}else{var _Yk = _Yc[1];var _Yl = E(_XX);var _Ym = _Yl[1];var _Yn = jsShowI(_Ym,realWorld);var _Yo = _Yn[2];var _Yp = E(_Yk);var _Yq = _Yp[1];var _Yr = jsSet(_Yq,_XJ,_Yo,_Y8);var _Ys = _Yr[1];var _Yt = _XS==_WQ;if(_Yt){var _Yu = [1,_Ys,_94];}else{var _Yv = _XS+1;_XP=_Yv;_XQ=_XY;_XR=_Ys;return null;var _Yw = die("Unreachable!");var _Yu = _Yw;}var _Yj = _Yu;}var _XW = _Yj;}return _XW;})(_XP,_XQ,_XR);if(null!==r)return r;}};var _Yx = _X9+1;var _Yy = _XO(_Yx,_Xf,_XL);var _XN = _Yy;}var _XA = _XN;}var _Xd = _XA;}return _Xd;})(_X6,_X7,_X8);if(null!==r)return r;}};var _X4 = _X5(1,_X2,_WS);}var _X1 = _X4;}return _X1;};var _Yz = 1>_WQ;if(_Yz){var _YA = _WR(_WO,_y);}else{var _YB = function(_YC,_YD){var _YE = T(function(){var _YF = jsShowI(_YC,realWorld);var _YG = _YF[2];var _YH = [1,_YG];var _YI = fromJSStr(_YH);return _YI;});var _YJ = [2,_I9,_YE];var _YK = toJSStr(_YJ);var _YL = _YK[1];var _YM = jsFind(_YL,_YD);var _YN = _YM[1];var _YO = _YM[2];var _YP = [1,_YO];var _YQ = _YP[1];var _YR = E(_YQ);if(_YR[0]==1){var _YS = _2Y(_Hc,_YN);var _YT = _YS[1];var _YU = _YS[2];var _YV = _YC==_WQ;if(_YV){var _YW = [2,_YU,_y];var _YX = [1,_YT,_YW];}else{var _YY = _YC+1;var _YZ = _YB(_YY,_YT);var _Z0 = _YZ[1];var _Z1 = _YZ[2];var _Z2 = [2,_YU,_Z1];var _Z3 = [1,_Z0,_Z2];var _YX = _Z3;}var _Z4 = _YX;}else{var _Z5 = _YR[1];var _Z6 = E(_Z5);var _Z7 = _Z6[1];var _Z8 = E(_I8);var _Z9 = _Z8[1];var _Za = jsGet(_Z7,_Z9,_YN);var _Zb = _Za[1];var _Zc = _Za[2];var _Zd = T(function(){var _Ze = [1,_Zc];var _Zf = fromJSStr(_Ze);return _Zf[0]==1?E(_I3):_Rn(_FB,_Zf);});var _Zg = _YC==_WQ;if(_Zg){var _Zh = [2,_Zd,_y];var _Zi = [1,_Zb,_Zh];}else{var _Zj = function(_Zk,_Zl){var _Zm = T(function(){var _Zn = jsShowI(_Zk,realWorld);var _Zo = _Zn[2];var _Zp = [1,_Zo];var _Zq = fromJSStr(_Zp);return _Zq;});var _Zr = [2,_I9,_Zm];var _Zs = toJSStr(_Zr);var _Zt = _Zs[1];var _Zu = jsFind(_Zt,_Zl);var _Zv = _Zu[1];var _Zw = _Zu[2];var _Zx = [1,_Zw];var _Zy = _Zx[1];var _Zz = E(_Zy);if(_Zz[0]==1){var _ZA = _2Y(_Hc,_Zv);var _ZB = _ZA[1];var _ZC = _ZA[2];var _ZD = _Zk==_WQ;if(_ZD){var _ZE = [2,_ZC,_y];var _ZF = [1,_ZB,_ZE];}else{var _ZG = _Zk+1;var _ZH = _Zj(_ZG,_ZB);var _ZI = _ZH[1];var _ZJ = _ZH[2];var _ZK = [2,_ZC,_ZJ];var _ZL = [1,_ZI,_ZK];var _ZF = _ZL;}var _ZM = _ZF;}else{var _ZN = _Zz[1];var _ZO = E(_ZN);var _ZP = _ZO[1];var _ZQ = jsGet(_ZP,_Z9,_Zv);var _ZR = _ZQ[1];var _ZS = _ZQ[2];var _ZT = T(function(){var _ZU = [1,_ZS];var _ZV = fromJSStr(_ZU);return _ZV[0]==1?E(_I3):_Rn(_FB,_ZV);});var _ZW = _Zk==_WQ;if(_ZW){var _ZX = [2,_ZT,_y];var _ZY = [1,_ZR,_ZX];}else{var _ZZ = _Zk+1;var _100 = _Zj(_ZZ,_ZR);var _101 = _100[1];var _102 = _100[2];var _103 = [2,_ZT,_102];var _104 = [1,_101,_103];var _ZY = _104;}var _ZM = _ZY;}return _ZM;};var _105 = _YC+1;var _106 = _Zj(_105,_Zb);var _107 = _106[1];var _108 = _106[2];var _109 = [2,_Zd,_108];var _10a = [1,_107,_109];var _Zi = _10a;}var _Z4 = _Zi;}return _Z4;};var _10b = _YB(1,_WO);var _10c = _10b[1];var _10d = _10b[2];var _10e = _WR(_10c,_10d);var _YA = _10e;}return _YA;};var _10f = _G9(_WL,_Ha,_WM,_WI);var _10g = _10f[1];var _10h = E(_WJ);var _10i = _10h[1];var _10j = function(_10k){return _VZ(_W0,_W1,_W2,_10k);};var _10l = function(_10m,_10n){return _10j(_10n);};var _10o = _G9(_10i,_Ha,_10l,_10g);var _10p = _10o[1];var _10q = [1,_10p,_94];var _Wy = _10q;}var _Wi = _Wy;}var _Wa = _Wi;}return _Wa;};return _VZ(_Ry,_Rz,_RA,_VY);};var _10r = function(_10s,_10n){return _VX(_10n);};var _10t = _G9(_VW,_Ha,_10r,_VU);var _10u = _10t[1];var _10v = [1,_10u,_94];var _Sc = _10v;}var _RU = _Sc;}var _RK = _RU;}return _RK;};var _10w = T(function(){return unCStr("Pattern match failure in do expression at Main.hs:48:43-53");});var _10x = T(function(){return unCStr("label");});var _10y = T(function(){return toJSStr(_10x);});var _10z = T(function(){return unCStr("selector");});var _10A = T(function(){return toJSStr(_10z);});var _10B = T(function(){return unCStr("option");});var _10C = T(function(){return toJSStr(_10B);});var _10D = T(function(){return toJSStr(_Hl);});var _10E = function(_10F,_10G,_10H){var _10I = E(_10G);if(_10I[0]==1){var _10J = [1,_10H,_94];}else{var _10K = _10I[1];var _10L = _10I[2];var _10M = E(_10K);var _10N = _10M[1];var _10O = E(_10C);var _10P = _10O[1];var _10Q = jsCreateElem(_10P,_10H);var _10R = _10Q[1];var _10S = _10Q[2];var _10T = E(_10A);var _10U = _10T[1];var _10V = jsFind(_10U,_10R);var _10W = _10V[1];var _10X = _10V[2];var _10Y = [1,_10X];var _10Z = _10Y[1];var _110 = E(_10Z);if(_110[0]==1){var _111 = _2Y(_10w,_10W);var _112 = _111[1];var _113 = E(_10F);if(_113==(-1)){var _114 = [1,_112,_94];}else{var _115 = function(_116,_117,_118){while(1){var _119 = E(_117);if(_119[0]==1){var _11a = [1,_118,_94];}else{var _11b = _119[1];var _11c = _119[2];var _11d = E(_11b);var _11e = _11d[1];var _11f = jsCreateElem(_10P,_118);var _11g = _11f[1];var _11h = _11f[2];var _11i = jsFind(_10U,_11g);var _11j = _11i[1];var _11k = _11i[2];var _11l = [1,_11k];var _11m = _11l[1];var _11n = E(_11m);if(_11n[0]==1){var _11o = _2Y(_10w,_11j);var _11p = _11o[1];var _11q = E(_116);if(_11q==(-1)){var _11r = [1,_11p,_94];}else{var _11s = _11q+1;_116=_11s;_117=_11c;_118=_11p;continue;var _11t = die("Unreachable!");var _11r = _11t;}var _11u = _11r;}else{var _11v = _11n[1];var _11w = E(_10y);var _11x = _11w[1];var _11y = toJSStr(_11e);var _11z = _11y[1];var _11A = jsSet(_11h,_11x,_11z,_11j);var _11B = _11A[1];var _11C = jsShowI(_116,realWorld);var _11D = _11C[2];var _11E = E(_10D);var _11F = _11E[1];var _11G = jsSet(_11h,_11F,_11D,_11B);var _11H = _11G[1];var _11I = E(_11v);var _11J = _11I[1];var _11K = jsAppendChild(_11h,_11J,_11H);var _11L = _11K[1];var _11M = E(_116);if(_11M==(-1)){var _11N = [1,_11L,_94];}else{var _11O = _11M+1;_116=_11O;_117=_11c;_118=_11L;continue;var _11P = die("Unreachable!");var _11N = _11P;}var _11u = _11N;}var _11a = _11u;}return _11a;}};var _11Q = _113+1;var _11R = _115(_11Q,_10L,_112);var _114 = _11R;}var _11S = _114;}else{var _11T = _110[1];var _11U = E(_10y);var _11V = _11U[1];var _11W = toJSStr(_10N);var _11X = _11W[1];var _11Y = jsSet(_10S,_11V,_11X,_10W);var _11Z = _11Y[1];var _120 = jsShowI(_10F,realWorld);var _121 = _120[2];var _122 = E(_10D);var _123 = _122[1];var _124 = jsSet(_10S,_123,_121,_11Z);var _125 = _124[1];var _126 = E(_11T);var _127 = _126[1];var _128 = jsAppendChild(_10S,_127,_125);var _129 = _128[1];var _12a = E(_10F);if(_12a==(-1)){var _12b = [1,_129,_94];}else{var _12c = function(_12d,_12e,_12f){while(1){var _12g = E(_12e);if(_12g[0]==1){var _12h = [1,_12f,_94];}else{var _12i = _12g[1];var _12j = _12g[2];var _12k = E(_12i);var _12l = _12k[1];var _12m = jsCreateElem(_10P,_12f);var _12n = _12m[1];var _12o = _12m[2];var _12p = jsFind(_10U,_12n);var _12q = _12p[1];var _12r = _12p[2];var _12s = [1,_12r];var _12t = _12s[1];var _12u = E(_12t);if(_12u[0]==1){var _12v = _2Y(_10w,_12q);var _12w = _12v[1];var _12x = E(_12d);if(_12x==(-1)){var _12y = [1,_12w,_94];}else{var _12z = _12x+1;_12d=_12z;_12e=_12j;_12f=_12w;continue;var _12A = die("Unreachable!");var _12y = _12A;}var _12B = _12y;}else{var _12C = _12u[1];var _12D = toJSStr(_12l);var _12E = _12D[1];var _12F = jsSet(_12o,_11V,_12E,_12q);var _12G = _12F[1];var _12H = jsShowI(_12d,realWorld);var _12I = _12H[2];var _12J = jsSet(_12o,_123,_12I,_12G);var _12K = _12J[1];var _12L = E(_12C);var _12M = _12L[1];var _12N = jsAppendChild(_12o,_12M,_12K);var _12O = _12N[1];var _12P = E(_12d);if(_12P==(-1)){var _12Q = [1,_12O,_94];}else{var _12R = _12P+1;_12d=_12R;_12e=_12j;_12f=_12O;continue;var _12S = die("Unreachable!");var _12Q = _12S;}var _12B = _12Q;}var _12h = _12B;}return _12h;}};var _12T = _12a+1;var _12U = _12c(_12T,_10L,_129);var _12b = _12U;}var _11S = _12b;}var _10J = _11S;}return _10J;};var _12V = T(function(){return unCStr("Pattern match failure in do expression at Main.hs:39:24-36");});var _12W = T(function(){return unCStr("Sudoku (9x9)");});var _12X = [1,81];var _12Y = function(_12Z){var _130 = E(_12Z);if(_130[0]==1){var _131 = [1];}else{var _132 = _130[1];var _133 = _130[2];var _134 = T(function(){return _12Y(_133);});var _131 = _J(_132,_134);}return _131;};var _135 = function(_136,_137){var _138 = E(_137);if(_138[0]==1){var _139 = [1];}else{var _13a = _138[1];var _13b = _138[2];var _13c = T(function(){return _135(_136,_13b);});var _13d = [2,_13a,_13c];var _139 = [2,_136,_13d];}return _139;};var _13e = function(_13f,_13g){var _13h = _13f%_13g;var _13i = _13f>0;if(_13i){var _13j = _13g<0;if(_13j){var _13k = E(_13h);var _13l = _13k?_13k+_13g|0:0;}else{var _13m = _13f<0;if(_13m){var _13n = _13g>0;if(_13n){var _13o = E(_13h);var _13p = _13o?_13o+_13g|0:0;}else{var _13p = E(_13h);}var _13q = _13p;}else{var _13q = E(_13h);}var _13l = _13q;}var _13r = _13l;}else{var _13s = _13f<0;if(_13s){var _13t = _13g>0;if(_13t){var _13u = E(_13h);var _13v = _13u?_13u+_13g|0:0;}else{var _13v = E(_13h);}var _13w = _13v;}else{var _13w = E(_13h);}var _13r = _13w;}return _13r;};var _13x = function(_13y,_13z){var _13A = _13y>0;if(_13A){var _13B = _13z<0;if(_13B){var _13C = _13y-1|0;var _13D = quot(_13C,_13z);var _13E = _13D-1|0;var _13F = _13E;}else{var _13G = _13y<0;if(_13G){var _13H = _13z>0;if(_13H){var _13I = _13y+1|0;var _13J = quot(_13I,_13z);var _13K = _13J-1|0;var _13L = _13K;}else{var _13L = quot(_13y,_13z);}var _13M = _13L;}else{var _13M = quot(_13y,_13z);}var _13F = _13M;}var _13N = _13F;}else{var _13O = _13y<0;if(_13O){var _13P = _13z>0;if(_13P){var _13Q = _13y+1|0;var _13R = quot(_13Q,_13z);var _13S = _13R-1|0;var _13T = _13S;}else{var _13T = quot(_13y,_13z);}var _13U = _13T;}else{var _13U = quot(_13y,_13z);}var _13N = _13U;}return _13N;};var _13V = [1];var _13W = T(function(){return _bW(_13V,_uP);});var _13X = function(_13Y,_13Z){var _140 = E(_13Z);switch(_140){case (-1):var _141 = E(_13Y);var _142 = _141==(-2147483648)?E(_13W):_13x(_141,(-1));break;case 0:var _142 = E(_uR);break;default:var _142 = _13x(_13Y,_140);}return _142;};var _143 = [1,' '];var _144 = [2,_143,_y];var _145 = [1,'r'];var _146 = [2,_145,_y];var _147 = T(function(){return unCStr("cell");});var _148 = [1,'d'];var _149 = [2,_148,_y];var _14a = [2,_149,_y];var _14b = T(function(){return unCStr("className");});var _14c = T(function(){return toJSStr(_14b);});var _14d = T(function(){return unCStr("id");});var _14e = T(function(){return toJSStr(_14d);});var _14f = T(function(){return unCStr("td");});var _14g = T(function(){return toJSStr(_14f);});var _14h = T(function(){return toJSStr(_Hh);});var _14i = T(function(){return unCStr("tr");});var _14j = T(function(){return toJSStr(_14i);});var _14k = function(_14l,_14m,_14n,_14o){var _14p = E(_14j);var _14q = _14p[1];var _14r = jsCreateElem(_14q,_14o);var _14s = _14r[1];var _14t = _14r[2];var _14u = T(function(){var _14v = E(_14l);var _14w = _14v[1];var _14x = _14w*_14w;var _14y = [1,_14x];return _14y;});var _14z = E(_14n);if(_14z[0]==1){var _14A = E(_14m);var _14B = _14A[1];var _14C = jsAppendChild(_14t,_14B,_14s);var _14D = _14C[1];var _14E = [1,_14D,_94];var _14F = _14E;}else{var _14G = _14z[1];var _14H = _14z[2];var _14I = E(_14h);var _14J = _14I[1];var _14K = jsCreateElem(_14J,_14s);var _14L = _14K[1];var _14M = _14K[2];var _14N = E(_14g);var _14O = _14N[1];var _14P = jsCreateElem(_14O,_14L);var _14Q = _14P[1];var _14R = _14P[2];var _14S = E(_14e);var _14T = _14S[1];var _14U = T(function(){var _14V = E(_14G);var _14W = _14V[1];var _14X = jsShowI(_14W,realWorld);var _14Y = _14X[2];var _14Z = [1,_14Y];var _150 = fromJSStr(_14Z);return _150;});var _151 = [2,_I9,_14U];var _152 = toJSStr(_151);var _153 = _152[1];var _154 = jsSet(_14M,_14T,_153,_14Q);var _155 = _154[1];var _156 = E(_14c);var _157 = _156[1];var _158 = T(function(){var _159 = E(_14u);var _15a = _159[1];var _15b = function(_15c){var _15d = _15c+1;var _15e = T(function(){var _15f = E(_14G);var _15g = _15f[1];var _15h = _15g-1;var _15i = _13X(_15h,_15a);var _15j = _15i+1;var _15k = _15j<_15a;if(_15k){var _15l = E(_14l);var _15m = _15l[1];var _15n = E(_15m);switch(_15n){case (-1):var _15o = E(_14a);break;case 0:var _15o = E(_uR);break;default:var _15p = _13e(_15j,_15n);var _15o = _15p?[1]:E(_14a);}var _15q = _15o;}else{var _15q = [1];}return _15q;});var _15r = _15d<_15a;if(_15r){var _15s = E(_14l);var _15t = _15s[1];var _15u = E(_15t);switch(_15u){case (-1):var _15v = [2,_146,_15e];var _15w = _135(_144,_15v);break;case 0:var _15w = E(_uR);break;default:var _15x = _13e(_15d,_15u);if(_15x){var _15y = _135(_144,_15e);}else{var _15z = [2,_146,_15e];var _15y = _135(_144,_15z);}var _15w = _15y;}var _15A = _15w;}else{var _15A = _135(_144,_15e);}return _15A;};var _15B = E(_15a);switch(_15B){case (-1):var _15C = _15b(0);break;case 0:var _15C = E(_uR);break;default:var _15D = E(_14G);var _15E = _15D[1];var _15F = _15E-1;var _15G = _13e(_15F,_15B);var _15H = _15b(_15G);var _15C = _15H;}return _15C;});var _15I = [2,_147,_158];var _15J = _12Y(_15I);var _15K = toJSStr(_15J);var _15L = _15K[1];var _15M = jsSet(_14R,_157,_15L,_155);var _15N = _15M[1];var _15O = jsAppendChild(_14M,_14R,_15N);var _15P = _15O[1];var _15Q = jsAppendChild(_14R,_14t,_15P);var _15R = _15Q[1];var _15S = function(_15T,_15U){while(1){var r=(function(_15V,_15W){var _15X = E(_15V);if(_15X[0]==1){var _15Y = [1,_15W,_94];}else{var _15Z = _15X[1];var _160 = _15X[2];var _161 = jsCreateElem(_14J,_15W);var _162 = _161[1];var _163 = _161[2];var _164 = jsCreateElem(_14O,_162);var _165 = _164[1];var _166 = _164[2];var _167 = T(function(){var _168 = E(_15Z);var _169 = _168[1];var _16a = jsShowI(_169,realWorld);var _16b = _16a[2];var _16c = [1,_16b];var _16d = fromJSStr(_16c);return _16d;});var _16e = [2,_I9,_167];var _16f = toJSStr(_16e);var _16g = _16f[1];var _16h = jsSet(_163,_14T,_16g,_165);var _16i = _16h[1];var _16j = T(function(){var _16k = E(_14u);var _16l = _16k[1];var _16m = function(_16n){var _16o = _16n+1;var _16p = T(function(){var _16q = E(_15Z);var _16r = _16q[1];var _16s = _16r-1;var _16t = _13X(_16s,_16l);var _16u = _16t+1;var _16v = _16u<_16l;if(_16v){var _16w = E(_14l);var _16x = _16w[1];var _16y = E(_16x);switch(_16y){case (-1):var _16z = E(_14a);break;case 0:var _16z = E(_uR);break;default:var _16A = _13e(_16u,_16y);var _16z = _16A?[1]:E(_14a);}var _16B = _16z;}else{var _16B = [1];}return _16B;});var _16C = _16o<_16l;if(_16C){var _16D = E(_14l);var _16E = _16D[1];var _16F = E(_16E);switch(_16F){case (-1):var _16G = [2,_146,_16p];var _16H = _135(_144,_16G);break;case 0:var _16H = E(_uR);break;default:var _16I = _13e(_16o,_16F);if(_16I){var _16J = _135(_144,_16p);}else{var _16K = [2,_146,_16p];var _16J = _135(_144,_16K);}var _16H = _16J;}var _16L = _16H;}else{var _16L = _135(_144,_16p);}return _16L;};var _16M = E(_16l);switch(_16M){case (-1):var _16N = _16m(0);break;case 0:var _16N = E(_uR);break;default:var _16O = E(_15Z);var _16P = _16O[1];var _16Q = _16P-1;var _16R = _13e(_16Q,_16M);var _16S = _16m(_16R);var _16N = _16S;}return _16N;});var _16T = [2,_147,_16j];var _16U = _12Y(_16T);var _16V = toJSStr(_16U);var _16W = _16V[1];var _16X = jsSet(_166,_157,_16W,_16i);var _16Y = _16X[1];var _16Z = jsAppendChild(_163,_166,_16Y);var _170 = _16Z[1];var _171 = jsAppendChild(_166,_14t,_170);var _172 = _171[1];_15T=_160;_15U=_172;return null;var _173 = die("Unreachable!");var _15Y = _173;}return _15Y;})(_15T,_15U);if(null!==r)return r;}};var _174 = _15S(_14H,_15R);var _175 = _174[1];var _176 = E(_14m);var _177 = _176[1];var _178 = jsAppendChild(_14t,_177,_175);var _179 = _178[1];var _17a = [1,_179,_94];var _14F = _17a;}return _14F;};var _17b = [1,3];var _17c = [1,9];var _17d = function(_17e,_17f){var _17g = _17e>_17f;if(_17g){var _17h = [1];}else{var _17i = function(_17j){var _17k = T(function(){var _17l = _17j==_17f;if(_17l){var _17m = [1];}else{var _17n = _17j+1|0;var _17o = _17i(_17n);var _17m = _17o;}return _17m;});var _17p = [1,_17j];return [2,_17p,_17k];};var _17h = _17i(_17e);}return _17h;};var _17q = T(function(){return _17d(1,81);});var _17r = function(_17s,_17t){var _17u = E(_17s);if(_17u){var _17v = E(_17t);if(_17v[0]==1){var _17w = [1,_y,_y];}else{var _17x = _17v[1];var _17y = _17v[2];var _17z = T(function(){var _17A = _17u-1|0;var _17B = _17r(_17A,_17y);var _17C = _17B[1];var _17D = _17B[2];var _17E = [1,_17C,_17D];return _17E;});var _17F = T(function(){var _17G = E(_17z);var _17H = _17G[2];var _17I = E(_17H);return _17I;});var _17J = T(function(){var _17K = E(_17z);var _17L = _17K[1];var _17M = E(_17L);return _17M;});var _17N = [2,_17x,_17J];var _17w = [1,_17N,_17F];}var _17O = _17w;}else{var _17O = [1,_y,_17t];}return _17O;};var _17P = function(_17Q,_17R){var _17S = E(_17R);if(_17S[0]==1){var _17T = [1];}else{var _17U = T(function(){var _17V = E(_17Q);var _17W = _17V[1];var _17X = _17W<0;if(_17X){var _17Y = [1,_y,_17S];}else{var _17Z = _17r(_17W,_17S);var _180 = _17Z[1];var _181 = _17Z[2];var _182 = [1,_180,_181];var _17Y = _182;}return _17Y;});var _183 = T(function(){var _184 = E(_17U);var _185 = _184[2];var _186 = _17P(_17Q,_185);return _186;});var _187 = T(function(){var _188 = E(_17U);var _189 = _188[1];var _18a = E(_189);return _18a;});var _17T = [2,_187,_183];}return _17T;};var _18b = T(function(){return _17P(_17c,_17q);});var _18c = function(_18d,_18e){var _18f = function(_18g,_18h){while(1){var _18i = E(_18g);if(_18i[0]==1){var _18j = [1,_18h,_94];}else{var _18k = _18i[1];var _18l = _18i[2];var _18m = _14k(_17b,_18d,_18k,_18h);var _18n = _18m[1];_18g=_18l;_18h=_18n;continue;var _18o = die("Unreachable!");var _18j = _18o;}return _18j;}};return _18f(_18b,_18e);};var _18p = T(function(){return _17d(1,9);});var _18q = function(_18r){var _18s = T(function(){var _18t = E(_18r);if(_18t==18){var _18u = [1];}else{var _18v = _18t+1;var _18w = _18q(_18v);var _18u = _18w;}return _18u;});var _18x = [1,_18r];var _18y = function(_18z){var _18A = E(_18z);if(_18A[0]==1){var _18B = E(_18s);}else{var _18C = _18A[1];var _18D = _18A[2];var _18E = T(function(){return _18y(_18D);});var _18F = T(function(){var _18G = E(_18C);var _18H = _18G[1];var _18I = _18H-1;var _18J = _13x(_18I,3);var _18K = _18r-9;var _18L = _18K-1;var _18M = _13x(_18L,3);var _18N = _18M*3;var _18O = _18J+_18N;var _18P = _18O+1;var _18Q = _18P+18;var _18R = [1,_18Q];return _18R;});var _18S = [2,_18F,_y];var _18T = [2,_18x,_18S];var _18U = [2,_18C,_18T];var _18V = [1,_18p,_18U];var _18B = [2,_18V,_18E];}return _18B;};return _18y(_18p);};var _18W = T(function(){return _18q(10);});var _18X = [1,_12W,_18W,_12X,_18c];var _18Y = T(function(){return unCStr("Sudoku (4x4)");});var _18Z = [1,2];var _190 = [1,4];var _191 = T(function(){return _17d(1,16);});var _192 = T(function(){return _17P(_190,_191);});var _193 = function(_194,_195){var _196 = function(_197,_198){while(1){var _199 = E(_197);if(_199[0]==1){var _19a = [1,_198,_94];}else{var _19b = _199[1];var _19c = _199[2];var _19d = _14k(_18Z,_194,_19b,_198);var _19e = _19d[1];_197=_19c;_198=_19e;continue;var _19f = die("Unreachable!");var _19a = _19f;}return _19a;}};return _196(_192,_195);};var _19g = [1,16];var _19h = T(function(){return _17d(1,4);});var _19i = function(_19j){var _19k = T(function(){var _19l = E(_19j);if(_19l==8){var _19m = [1];}else{var _19n = _19l+1;var _19o = _19i(_19n);var _19m = _19o;}return _19m;});var _19p = [1,_19j];var _19q = function(_19r){var _19s = E(_19r);if(_19s[0]==1){var _19t = E(_19k);}else{var _19u = _19s[1];var _19v = _19s[2];var _19w = T(function(){return _19q(_19v);});var _19x = T(function(){var _19y = E(_19u);var _19z = _19y[1];var _19A = _19z-1;var _19B = _13x(_19A,2);var _19C = _19j-4;var _19D = _19C-1;var _19E = _13x(_19D,2);var _19F = _19E*2;var _19G = _19B+_19F;var _19H = _19G+1;var _19I = _19H+8;var _19J = [1,_19I];return _19J;});var _19K = [2,_19x,_y];var _19L = [2,_19p,_19K];var _19M = [2,_19u,_19L];var _19N = [1,_19h,_19M];var _19t = [2,_19N,_19w];}return _19t;};return _19q(_19h);};var _19O = T(function(){return _19i(5);});var _19P = [1,_18Y,_19O,_19g,_193];var _19Q = T(function(){return unCStr("Sudoku (16x16) (slow!)");});var _19R = [1,256];var _19S = T(function(){return _17d(1,256);});var _19T = T(function(){return _17P(_19g,_19S);});var _19U = function(_19V,_19W){var _19X = function(_19Y,_19Z){while(1){var _1a0 = E(_19Y);if(_1a0[0]==1){var _1a1 = [1,_19Z,_94];}else{var _1a2 = _1a0[1];var _1a3 = _1a0[2];var _1a4 = _14k(_190,_19V,_1a2,_19Z);var _1a5 = _1a4[1];_19Y=_1a3;_19Z=_1a5;continue;var _1a6 = die("Unreachable!");var _1a1 = _1a6;}return _1a1;}};return _19X(_19T,_19W);};var _1a7 = T(function(){return _17d(1,16);});var _1a8 = function(_1a9){var _1aa = T(function(){var _1ab = E(_1a9);if(_1ab==32){var _1ac = [1];}else{var _1ad = _1ab+1;var _1ae = _1a8(_1ad);var _1ac = _1ae;}return _1ac;});var _1af = [1,_1a9];var _1ag = function(_1ah){var _1ai = E(_1ah);if(_1ai[0]==1){var _1aj = E(_1aa);}else{var _1ak = _1ai[1];var _1al = _1ai[2];var _1am = T(function(){return _1ag(_1al);});var _1an = T(function(){var _1ao = E(_1ak);var _1ap = _1ao[1];var _1aq = _1ap-1;var _1ar = _13x(_1aq,4);var _1as = _1a9-16;var _1at = _1as-1;var _1au = _13x(_1at,4);var _1av = _1au*4;var _1aw = _1ar+_1av;var _1ax = _1aw+1;var _1ay = _1ax+32;var _1az = [1,_1ay];return _1az;});var _1aA = [2,_1an,_y];var _1aB = [2,_1af,_1aA];var _1aC = [2,_1ak,_1aB];var _1aD = [1,_1a7,_1aC];var _1aj = [2,_1aD,_1am];}return _1aj;};return _1ag(_1a7);};var _1aE = T(function(){return _1a8(17);});var _1aF = [1,_19Q,_1aE,_19R,_19U];var _1aG = [2,_1aF,_y];var _1aH = [2,_19P,_1aG];var _1aI = [2,_18X,_1aH];var _1aJ = T(function(){return _35(_1aI,0);});var _1aK = "value";var _1aL = [1,_1aK];var _1aM = "selector";var _1aN = [1,_1aM];var _1aO = function(_1aP){var _1aQ = _10E(0,_1aI,_1aP);var _1aR = _1aQ[1];var _1aS = E(_1aN);var _1aT = _1aS[1];var _1aU = jsFind(_1aT,_1aR);var _1aV = _1aU[1];var _1aW = _1aU[2];var _1aX = [1,_1aW];var _1aY = _1aX[1];var _1aZ = E(_1aY);if(_1aZ[0]==1){var _1b0 = _2Y(_12V,_1aV);var _1b1 = _1b0[1];var _1b2 = [1,_1b1,_94];var _1b3 = _1b2;}else{var _1b4 = _1aZ[1];var _1b5 = E(_1b4);var _1b6 = _1b5[1];var _1b7 = function(_1b8){var _1b9 = E(_1aL);var _1ba = _1b9[1];var _1bb = jsGet(_1b6,_1ba,_1b8);var _1bc = _1bb[1];var _1bd = _1bb[2];var _1be = [1,_1bd];var _1bf = fromJSStr(_1be);if(_1bf[0]==1){var _1bg = E(_1aJ);var _1bh = _1bg[2];var _1bi = _1bg[3];var _1bj = _1bg[4];var _1bk = _Rx(_1bh,_1bi,_1bj,_1bc);var _1bl = _1bk;}else{var _1bm = _Rn(_FB,_1bf);var _1bn = _1bm[1];var _1bo = _1bn<0;if(_1bo){var _1bp = E(_32);}else{var _1bq = _35(_1aI,_1bn);var _1br = _1bq[2];var _1bs = _1bq[3];var _1bt = _1bq[4];var _1bu = _Rx(_1br,_1bs,_1bt,_1bc);var _1bp = _1bu;}var _1bl = _1bp;}return _1bl;};var _1bv = _G9(_1b6,_FE,_1b7,_1aV);var _1bw = _1bv[1];var _1bx = [1,_1bw,_94];var _1b3 = _1bx;}return _1b3;};var _1by = function(_10n){return _1aO(_10n);};
window.onload = function() {E(E(_1by)(0));};
