(function (root) {
    'use strict';
    function decode(input, encoding = 'auto') {
        const bytes = new Uint8Array(input);
        const read = label => new TextDecoder(label, {fatal: true}).decode(bytes);
        let selected = encoding;
        if (selected === 'auto') {
            if (bytes[0] === 0xff && bytes[1] === 0xfe) selected = 'utf-16le';
            else if (bytes[0] === 0xfe && bytes[1] === 0xff) selected = 'utf-16be';
            else {
                try { read('utf-8'); selected = 'utf-8'; }
                catch (_) { selected = 'gb18030'; }
            }
        }
        const text = read(selected);
        return {text, encoding: selected, newline: text.includes('\r\n') ? '\r\n' : '\n',
            bom: selected === 'utf-8' && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf};
    }
    function encode(text, metadata) {
        const normalized = text.replace(/\r\n|\r|\n/g, metadata.newline);
        return new TextEncoder().encode((metadata.bom ? '\ufeff' : '') + normalized);
    }
    root.AirTextCodec = {decode, encode};
    if (typeof module !== 'undefined' && module.exports) module.exports = root.AirTextCodec;
})(globalThis);
