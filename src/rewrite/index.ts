import express from 'express'
import serve from './serve'

const port = process.env.PORT || 3000

const app = express()
const rootDir = process.argv[process.argv.length - 1]
app.use(serve(rootDir))
app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})