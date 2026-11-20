// The Emscripten glue in occt-import-js 0.0.23 (embind) builds two kinds of small wrapper functions
// from source text with `new Function`, which a Content Security Policy without 'unsafe-eval' (Orca's
// plugin frames) refuses. tools/build-vendor.mjs writes vendor/occt/occt-import-js.csp.js with these
// two spots swapped for the closure-based equivalents Emscripten itself emits when built with
// -sDYNAMIC_EXECUTION=0. The unmodified library stays beside it (LGPL-2.1: modification notice and
// the original are shipped).
export const EVAL_PATCHES = [
  [
    'var invokerFn=newFunc(Function,args)(...closureArgs);',
    'var invokerFn=function(...a){var destructors=needsDestructorStack?[]:null;var wired=[cppTargetFunc];var thisWired;' +
      "if(isClassMethodFunc){thisWired=argTypes[1]['toWireType'](destructors,this);wired.push(thisWired)}" +
      "var argWired=[];for(var k=0;k<argCount-2;++k){var w=argTypes[k+2]['toWireType'](destructors,a[k]);argWired.push(w);wired.push(w)}" +
      'var rv=cppInvokerFunc(...wired);' +
      'if(needsDestructorStack){runDestructors(destructors)}else{for(var k=isClassMethodFunc?1:2;k<argTypes.length;++k){' +
      'if(argTypes[k].destructorFunction!==null){argTypes[k].destructorFunction(k===1?thisWired:argWired[k-2])}}}' +
      "if(returns){return argTypes[0]['fromWireType'](rv)}};"
  ],
  [
    'var invokerFunction=newFunc(Function,params)(...args);',
    'var invokerFunction=function(obj,func,destructorsRef,argsPtr){var off=0;var vals=[];' +
      'for(var k=0;k<argCount;++k){vals.push(types[k].readValueFromPointer(argsPtr+off));off+=types[k].argPackAdvance}' +
      'var rv=kind===1?Reflect.construct(func,vals):kind===0?func.apply(obj,vals):func.call(...vals);' +
      'return retType.isVoid?undefined:emval_returnValue(retType,destructorsRef,rv)};'
  ]
]

export function patchOcct(text) {
  for (const [from, to] of EVAL_PATCHES) {
    if (!text.includes(from)) throw new Error(`occt-import-js: pattern not found, update tools/occt-patches.mjs: ${from}`)
    text = text.split(from).join(to)
  }
  if (/new Function|newFunc\(Function/.test(text)) throw new Error('occt-import-js: code generation left after patching')
  return text
}
