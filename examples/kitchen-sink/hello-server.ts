import {helloLodash} from "hello-lodash.ts"
import {hello} from "hello-world.ts"

document.querySelector('#server-output').innerText = `${hello()} ${helloLodash()}`
