// The Emscripten glue of @mlightcad/libredwg-web (embind) builds two kinds of small wrapper functions
// from source text with `new Function`, which a Content Security Policy without 'unsafe-eval' (Orca's
// plugin frames and workers) refuses. tools/build-dwg-vendor.mjs bundles a copy of the glue with these
// two spots swapped for closures that do the same work (the code Emscripten emits with
// -sDYNAMIC_EXECUTION=0). GPL-3.0: the modification is stated in the shipped file and in
// dwg-plugin/vendor/libredwg/README.md.
export const EVAL_PATCHES = [
  [
    // createJsInvoker(argTypes, isClassMethodFunc, returns, isAsync): returns a factory that takes the
    // closure arguments (humanName, throwBindingError, invoker, fn, runDestructors, fromRetWire,
    // toClassParamWire, toArg0Wire.., then one destructor per argument that has one) and returns the
    // invoker.
    'invokerFnBody+="}\\n";return new Function(args1,invokerFnBody)}',
    'return function(humanName,throwBindingError,invoker,fn,runDestructors,fromRetWire,toClassParamWire,...rest){' +
      'var toArgWire=rest.slice(0,argCount);var dtors=rest.slice(argCount);' +
      'return function(...a){var destructors=needsDestructorStack?[]:null;var wired=[fn];var thisWired;' +
      'if(isClassMethodFunc){thisWired=toClassParamWire(destructors,this);wired.push(thisWired)}' +
      'var argWired=[];for(var k=0;k<argCount;++k){var w=toArgWire[k](destructors,a[k]);argWired.push(w);wired.push(w)}' +
      'var rv=invoker(...wired);' +
      'if(needsDestructorStack){runDestructors(destructors)}else{var d=0;for(var k=isClassMethodFunc?1:2;k<argTypes.length;++k){' +
      'if(argTypes[k].destructorFunction!==null){dtors[d++](k===1?thisWired:argWired[k-2])}}}' +
      'if(returns){return fromRetWire(rv)}}}}'
  ],
  [
    // __emval_create_invoker: calls a JavaScript value (kind 0), a method on it (1), a constructor (2),
    // or returns its argument (3), reading the arguments from wasm memory.
    'var invokerFunction=new Function(Object.keys(captures),functionBody)(...Object.values(captures));',
    'var invokerFunction=function(handle,methodName,destructorsRef,args){' +
      'var vals=argFromPtr.map(function(f,i){return f(args+i*GenericWireTypeSize)});var rv;' +
      'if(kind===0){rv=Emval.toValue(handle)(...vals)}' +
      'else if(kind===2){var C=Emval.toValue(handle);rv=new C(...vals)}' +
      'else if(kind===3){rv=vals[vals.length-1]}' +
      'else{var o=Emval.toValue(handle);rv=o[getStringOrSymbol(methodName)](...vals)}' +
      'return retType.isVoid?undefined:emval_returnValue(toReturnWire,destructorsRef,rv)};'
  ]
]

export function patchLibredwg(text) {
  // the replaced body is unreachable dead text before `return new Function`; keep the generator loop
  // (it only builds strings) so the patch stays small and easy to review.
  for (const [from, to] of EVAL_PATCHES) {
    const n = text.split(from).length - 1
    if (n !== 1) throw new Error(`libredwg-web: pattern found ${n} times, update tools/libredwg-patches.mjs: ${from.slice(0, 80)}`)
    text = text.replace(from, () => to)
  }
  if (/new Function|\beval\(|(?<![\w$])Function\(/.test(text)) throw new Error('libredwg-web: code generation left after patching')
  return text
}
