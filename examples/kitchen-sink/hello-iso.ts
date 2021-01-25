import {helloLodash} from "./hello-lodash.ts"
import {hello} from "./hello-world.ts"

const output = window.document.querySelector('#iso-output')
output.innerHTML = `${output.innerHTML}
${hello()} ${helloLodash()}`
console.log('!!!')
