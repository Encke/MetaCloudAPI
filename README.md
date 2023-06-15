# MetaCloudAPI

MetaCloud API - What's App Messaging System

Add the API to your repo

```bash
npm i https://github.com/Encke/MetaCloudAPI
```

Include the module

```javascript
const metaCloudAPI = require('metacloudapi')
```

Initialize the module

```javascript
metaCloudAPI.start(
  'v16.0',
  process.env.WHATS_APP_FROM_NUMBER,
  process.env.WHATS_APP_KEY,
  '/var/www/html/downloadedFiles/',
  'https://www.com/downloadedFiles/',
  (message) => console.log('outbound formatted message', message),
  (messageId) => console.log('get existing message row', messageId),
  (_id, statuses) =>
    console.log('update existing message statuses', _id, statuses)
)

//connect your webhook to the module to format incoming messages
metaCloudAPI.receive(req, (message) =>
  console.log('incoming formatted message')
)
```

Send outbound messages

```javascript
//send template
console.log(
  await metaCloudAPI.send.template(
    '12135551212',
    'template_name',
    'language_code',
    ['parameter 1', 'parameter 2']
  )
)

//send text
await metaCloudAPI.send.text('12135551212', 'Text message content to send')

//return a file for Meta Download
const fileCode = '123ABC'
if (metaCloudAPI.files[fileCode]) {
  res.setHeader('Content-Type', metaCloudAPI.files[fileCode].mime)
  res.end(metaCloudAPI.files[fileCode].data)
} else {
  res.end('not found')
}
```
