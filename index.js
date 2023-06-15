const axios = require('axios')
const FormData = require('form-data')
const fs = require('fs')
const mime = require('mime-kind')

const FILE_EXPIRY_DELAY = 1000 * 60 * 60 * 24 * 2 // 2 days

const messaging_product = 'whatsapp'
let messaging_version = null

const onlyNums = (string) => string.replace(/\D/g, '')

const randomString = (length) => {
  const randomCharacters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++)
    result += randomCharacters.charAt(
      Math.floor(Math.random() * randomCharacters.length)
    )
  return result
}

const meta = {
  files: {},
  fileInterval: null,
  saveOutbound: null,
  findMessage: null,
  updateStatus: null,
  phoneNumberId: null,
  key: null,
  downloadToDirectory: null,
  downloadFromURL: null,
  start: (
    version,
    phoneNumberId,
    key,
    downloadToDirectory,
    downloadFromURL,
    saveOutbound,
    findMessage,
    updateStatus
  ) => {
    messaging_version = version
    meta.phoneNumberId = phoneNumberId
    meta.key = key
    meta.downloadToDirectory = downloadToDirectory
    meta.downloadFromURL = downloadFromURL
    meta.saveOutbound = saveOutbound
    meta.findMessage = findMessage
    meta.updateStatus = updateStatus
    meta.fileInterval = setInterval(meta.cleanOldFiles, 1000 * 60)
  },
  cleanOldFiles: () => {
    const newFiles = []
    for (let file in meta.files) {
      if (meta.files[file].expires < new Date().getTime()) {
        newFiles.push(meta.files[file])
      }
    }
    meta.files = newFiles
  },
  sendData: async (userId, type, to, data, replyTo) => {
    try {
      //console.log(userId)
      //console.log(data)
      console.log(meta.prepare(type, to, data, replyTo))
      const result = (
        await axios.post(
          'https://graph.facebook.com/' +
            messaging_version +
            '/' +
            meta.phoneNumberId +
            '/messages',
          meta.prepare(type, to, data, replyTo),
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + meta.key,
            },
          }
        )
      ).data
      //console.log(result)
      const messageId =
        result && result.messages && result.messages.length > 0
          ? result.messages[0].id
          : null
      if (type != 'read')
        await meta.saveOutbound({
          userId,
          type,
          to: parseInt(to),
          data,
          replyTo,
          messageId,
          result: result,
          added: new Date(),
          statuses: [],
          success: true,
        })
      return messageId ? messageId : result
    } catch (e) {
      const error =
        e && e.response && e.response.data && e.response.data.error
          ? e.response.data.error
          : e
      console.log('Meta Messaging Error', error)
      if (type != 'read')
        await meta.saveOutbound({
          userId,
          type,
          to,
          data,
          replyTo,
          error,
          added: new Date(),
          success: false,
        })
    }
  },
  getAddress: (street, city, state, zip, country, country_code, type) => ({
    street,
    city,
    state,
    zip,
    country,
    country_code,
    type,
  }),
  getContact: (user) => {
    const contact = {}
    if (user.birthday) contact.birthday = user.birthday
    if (
      user.fullName ||
      user.prefix ||
      user.firstName ||
      user.middleName ||
      user.lastName ||
      user.suffix
    ) {
      contact.name = {}
      if (user.fullName) contact.name.formatted_name = user.fullName
      if (user.prefix) contact.name.prefix = user.prefix
      if (user.firstName) contact.name.first_name = user.firstName
      if (user.middleName) contact.name.middle_name = user.middleName
      if (user.lastName) contact.name.last_name = user.lastName
      if (user.suffix) contact.name.suffix = user.suffix
    }
    if (user.companyName || user.departmentName || user.companyTitle) {
      contact.org = {}
      if (user.companyName) contact.org.company = user.companyName
      if (user.departmentName) contact.org.department = user.departmentName
      if (user.companyTitle) contact.org.title = user.companyTitle
    }
    if (user.addresses && user.addresses.length > 0) {
      contact.addresses = []
      for (let i = 0; i < user.addresses.length; i++) {
        contact.addresses.push(
          meta.getAddress(
            user.addresses[i].street,
            user.addresses[i].city,
            user.addresses[i].state,
            user.addresses[i].zip,
            user.addresses[i].country,
            user.addresses[i].country_code,
            user.addresses[i].type
          )
        )
      }
    }
    if (user.emails && user.emails.length > 0) {
      contact.emails = []
      for (let i = 0; i < user.emails.length; i++) {
        contact.emails.push({
          email: user.emails[i].address,
          type: user.emails[i].type,
        })
      }
    }
    if (user.phones && user.phones.length > 0) {
      contact.phones = []
      for (let i = 0; i < user.phones.length; i++) {
        contact.phones.push({
          phone: user.phones[i].phone,
          type: user.phones[i].type,
          wa_id: onlyNums(user.phones[i].phone),
        })
      }
    }
    if (user.urls && user.urls.length > 0) {
      contact.urls = []
      for (let i = 0; i < user.urls.length; i++) {
        contact.urls.push({ url: user.urls[i].link, type: user.urls[i].type })
      }
    }
    return contact
  },
  getHeader: (header) => {
    const dataToReturn =
      typeof header == 'string'
        ? { type: 'text', text: header }
        : { type: header.type }
    if (!dataToReturn.text) {
      dataToReturn[header.type] = { link: header.link }
    }
    return dataToReturn
  },
  prepare: (type, to, data, replyTo) => {
    switch (type) {
      case 'template':
        const parameters = []
        for (let value of data.components) {
          if (value.type) {
            parameters.push(value)
          } else {
            parameters.push({
              type: 'text',
              text: value,
            })
          }
        }
        const template = {
          messaging_product,
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: data.name,
            language: { policy: 'deterministic', code: data.language },
            components: [{ type: 'body', parameters }],
          },
        }
        if (replyTo) template.context = { message_id: replyTo }
        return template
      case 'text':
        const text = {
          messaging_product,
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            preview_url: data.previewUrl,
            body: data.text,
          },
        }
        if (replyTo) text.context = { message_id: replyTo }
        return text
      case 'buttons':
        const buttons = []
        for (let i = 0; i < data.buttons.length; i++) {
          buttons.push({
            type: 'reply',
            reply:
              typeof data.buttons[i] == 'string'
                ? {
                    id: 'UNIQUE_BUTTON_ID_' + i,
                    title: data.buttons[i].substr(0, 20),
                  }
                : data.buttons[i],
          })
        }
        const button = {
          messaging_product,
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: data.text },
            action: { buttons },
          },
        }
        if (data.header) button.interactive.header = meta.getHeader(data.header)
        if (data.footer) button.interactive.footer = { text: data.footer }
        if (replyTo) button.context = { message_id: replyTo }
        return button
      case 'reaction':
        return {
          messaging_product,
          recipient_type: 'individual',
          to,
          type: 'reaction',
          reaction: { message_id: data.messageId, emoji: data.emoji },
        }
      case 'file':
        const dataToReturn = {
          messaging_product,
          recipient_type: 'individual',
          to,
          type: data.type,
        }
        dataToReturn[data.type] = { link: data.link }
        if (data.caption) dataToReturn[data.type].caption = data.caption
        if (replyTo) dataToReturn.context = { message_id: replyTo }
        return dataToReturn
      case 'location':
        const location = {
          messaging_product,
          to,
          type: 'location',
          location: {
            longitude: data.longitude,
            latitude: data.latitude,
            name: data.name,
            address: data.address,
          },
        }
        if (replyTo) location.context = { message_id: replyTo }
        return location
      case 'contacts':
        if (!Array.isArray(data.contacts)) {
          data.contacts = [data.contacts]
        }
        for (let i = 0; i < data.contacts.length; i++) {
          data.contacts[i] = meta.getContact(data.contacts[i])
        }
        const reply = {
          messaging_product,
          to,
          type: 'contacts',
          contacts: data.contacts,
        }
        if (replyTo) reply.context = { message_id: replyTo }
        return reply
      case 'list':
        const sections = []
        for (let section of data.sections) {
          const rows = []
          for (let row of section.rows) {
            rows.push({
              id: row.name.split(' ').join('_').toUpperCase(),
              title: row.name,
              description: row.description,
            })
          }
          sections.push({
            title: section.name,
            rows,
          })
        }
        const list = {
          messaging_product,
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'list',
            action: {
              button: data.buttonText,
              sections,
            },
          },
        }
        if (data.header) list.interactive.header = meta.getHeader(data.header)
        if (data.body) list.interactive.body = { text: data.body }
        if (data.footer) list.interactive.footer = { text: data.footer }
        if (replyTo) list.context = { message_id: replyTo }
        return list
      case 'product':
        const product = {
          messaging_product,
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'product',
            action: {
              catalog_id: data.catalogId,
              product_retailer_id: data.productId,
            },
          },
        }
        if (data.body) product.interactive.body = { text: data.body }
        if (data.footer) product.interactive.footer = { text: data.footer }
        if (replyTo) product.context = { message_id: replyTo }
        return product
      case 'productList':
        const productSections = []
        for (let section of data.sections) {
          const product_items = []
          for (let product_retailer_id of section.products) {
            product_items.push({ product_retailer_id })
          }
          productSections.push({ title: section.name, product_items })
        }
        const productList = {
          messaging_product,
          recipient_type: 'individual',
          to,
          type: 'interactive',
          interactive: {
            type: 'product_list',
            action: { catalog_id: data.catalogId, sections: productSections },
          },
        }
        if (data.header)
          productList.interactive.header = meta.getHeader(data.header)
        if (data.body) productList.interactive.body = { text: data.body }
        if (data.footer) productList.interactive.footer = { text: data.footer }
        if (replyTo) productList.context = { message_id: replyTo }
        return productList
      case 'read':
        return {
          messaging_product,
          status: 'read',
          message_id: to,
        }
    }
  },
  receive: async (req, processMessage) => {
    if (req.entry && req.object == 'whatsapp_business_account') {
      for (let i = 0; i < req.entry.length; i++) {
        //console.log(req.entry[i])
        if (req.entry[i].changes) {
          for (let n = 0; n < req.entry[i].changes.length; n++) {
            //console.log(JSON.stringify(req.entry[i].changes[n], null, 2))
            if (
              req.entry[i].changes[n].value &&
              req.entry[i].changes[n].value.statuses
            ) {
              for (
                let m = 0;
                m < req.entry[i].changes[n].value.statuses.length;
                m++
              ) {
                const message = await meta.findMessage(
                  req.entry[i].changes[n].value.statuses[m].id
                )
                if (message) {
                  message.statuses.push({
                    status: req.entry[i].changes[n].value.statuses[m].status,
                    on: new Date(
                      parseInt(
                        req.entry[i].changes[n].value.statuses[m].timestamp +
                          '000'
                      )
                    ),
                    to: req.entry[i].changes[n].value.statuses[m].recipient_id,
                  })
                  await meta.updateStatus(message._id, message.statuses)
                }
              }
            }
            let profileName = null
            if (
              req.entry[i].changes[n].value &&
              req.entry[i].changes[n].value.contacts
            ) {
              for (
                let m = 0;
                m < req.entry[i].changes[n].value.contacts.length;
                m++
              ) {
                profileName =
                  req.entry[i].changes[n].value.contacts[m].profile &&
                  req.entry[i].changes[n].value.contacts[m].profile.name
                    ? req.entry[i].changes[n].value.contacts[m].profile.name
                    : null
                //console.log(req.entry[i].changes[n].value.contacts[m])
              }
            }
            if (
              req.entry[i].changes[n].value &&
              req.entry[i].changes[n].value.messages
            ) {
              for (
                let m = 0;
                m < req.entry[i].changes[n].value.messages.length;
                m++
              ) {
                const messageId = req.entry[i].changes[n].value.messages[m].id
                const from = req.entry[i].changes[n].value.messages[m].from
                const timestamp =
                  req.entry[i].changes[n].value.messages[m].timestamp
                const replyData = req.entry[i].changes[n].value.messages[m]
                  .context
                  ? req.entry[i].changes[n].value.messages[m].context
                  : null
                //console.log(req.entry[i].changes[n].value.messages[m])
                if (
                  req.entry[i].changes[n].value.messages[m] &&
                  req.entry[i].changes[n].value.messages[m].text &&
                  req.entry[i].changes[n].value.messages[m].text.body
                ) {
                  processMessage({
                    profileName,
                    messageId,
                    from,
                    timestamp,
                    replyData,
                    text: req.entry[i].changes[n].value.messages[m].text.body,
                    route: 'meta',
                  })
                } else if (
                  req.entry[i].changes[n].value.messages[m] &&
                  req.entry[i].changes[n].value.messages[m].interactive &&
                  req.entry[i].changes[n].value.messages[m].interactive
                    .button_reply &&
                  req.entry[i].changes[n].value.messages[m].interactive
                    .button_reply.title
                ) {
                  processMessage({
                    profileName,
                    messageId,
                    from,
                    timestamp,
                    replyData,
                    text: req.entry[i].changes[n].value.messages[m].interactive
                      .button_reply.title,
                    buttonId:
                      req.entry[i].changes[n].value.messages[m].interactive
                        .button_reply.id,
                    route: 'meta',
                  })
                } else if (
                  req.entry[i].changes[n].value.messages[m] &&
                  req.entry[i].changes[n].value.messages[m].button &&
                  req.entry[i].changes[n].value.messages[m].button.payload
                ) {
                  processMessage({
                    profileName,
                    messageId,
                    from,
                    timestamp,
                    replyData,
                    text: req.entry[i].changes[n].value.messages[m].button
                      .payload,
                    route: 'meta',
                  })
                } else if (
                  req.entry[i].changes[n].value.messages[m] &&
                  req.entry[i].changes[n].value.messages[m].type &&
                  req.entry[i].changes[n].value.messages[m][
                    req.entry[i].changes[n].value.messages[m].type
                  ]
                ) {
                  const file =
                    req.entry[i].changes[n].value.messages[m][
                      req.entry[i].changes[n].value.messages[m].type
                    ]
                  if (['list_reply'].includes(file.type)) {
                    processMessage({
                      profileName,
                      messageId,
                      text: '',
                      option: file.list_reply
                        ? {
                            id: file.list_reply.id,
                            text: file.list_reply.title,
                          }
                        : null,
                      from,
                      timestamp,
                      replyData,
                      route: 'meta',
                    })
                  } else {
                    processMessage({
                      profileName,
                      messageId,
                      text: file.caption ? file.caption : '',
                      from,
                      timestamp,
                      replyData,
                      fileType: req.entry[i].changes[n].value.messages[m].type,
                      mime: file.mime_type
                        ? file.mime_type.split(';').shift()
                        : null,
                      isVoice: !!file.voice,
                      fileName: await meta.fileManager.download(file.id),
                      route: 'meta',
                    })
                  }
                }
                /*console.log( JSON.stringify( req.entry[i].changes[n].value.messages[m], null, 2 ) )*/
              }
            }
          }
        }
      }
    }
  },
  send: {
    template: (user, name, language, components, replyTo) =>
      meta.sendData(
        user._id,
        'template',
        user.phone,
        { name, language, components },
        replyTo
      ),
    buttons: (user, text, buttons, header, footer, replyTo) =>
      meta.sendData(
        user._id,
        'buttons',
        user.phone,
        { text, buttons, header, footer },
        replyTo
      ),
    text: (user, text, replyTo, previewUrl) =>
      meta.sendData(
        user._id,
        'text',
        user.phone,
        { previewUrl, text },
        replyTo
      ),
    reaction: (user, messageId, emoji, replyTo) =>
      meta.sendData(
        user._id,
        'reaction',
        user.phone,
        { messageId, emoji },
        replyTo
      ),
    addFile: async (fileLocation, fileBuffer, saveAsFrequent) => {
      if (fileLocation && STATIC_FILES[fileLocation.split('/').pop()])
        return STATIC_FILES[fileLocation.split('/').pop()]
      if (fileLocation && fileLocation.indexOf('http') == 0)
        return {
          type: ['mp4', 'mov'].includes(
            fileLocation.split('.').pop().toLowerCase()
          )
            ? 'video'
            : 'image',
          link: fileLocation,
          name: fileLocation.split('/').pop(),
        }
      fileBuffer = fileBuffer ? fileBuffer : fs.readFileSync(fileLocation)
      const fileCode = randomString(10)
      return meta.fileManager.add(
        saveAsFrequent,
        fileCode,
        (await mime(fileBuffer)).mime,
        fileBuffer
      )
    },
    file: async (
      user,
      fileLocation,
      fileBuffer,
      saveAsFrequent,
      name,
      caption,
      replyTo
    ) => {
      const linkData = await meta.send.addFile(
        fileLocation,
        fileBuffer,
        saveAsFrequent
      )
      return meta.sendData(
        user._id,
        'file',
        user.phone,
        {
          type: linkData.type,
          link: linkData.link,
          name: name ? name : fileLocation.split('/').pop(),
          caption,
        },
        replyTo
      )
    },
    location: (user, longitude, latitude, name, address, replyTo) =>
      meta.sendData(
        user._id,
        'location',
        user.phone,
        {
          longitude,
          latitude,
          name,
          address,
        },
        replyTo
      ),
    contacts: (user, list, replyTo) =>
      meta.sendData(
        user._id,
        'contacts',
        user.phone,
        { contacts: list },
        replyTo
      ),
    list: (user, header, body, footer, buttonText, sections, replyTo) =>
      meta.sendData(
        user._id,
        'list',
        user.phone,
        { header, body, footer, buttonText, sections },
        replyTo
      ),
    product: (user, body, footer, catalogId, productId, replyTo) =>
      meta.sendData(
        user._id,
        'product',
        user.phone,
        { body, footer, catalogId, productId },
        replyTo
      ),
    productList: (user, header, body, footer, catalogId, sections, replyTo) =>
      meta.sendData(
        user._id,
        'productList',
        user.phone,
        { header, body, footer, catalogId, sections },
        replyTo
      ),
    read: (user, messageId) => meta.sendData(user._id, 'read', messageId),
  },
  fileManager: {
    types: {
      audio: {
        mime: [
          'audio/aac',
          'audio/mp4',
          'audio/mpeg',
          'audio/amr',
          'audio/ogg',
          'audio/wav',
        ],
        maxKB: 16 * 1024,
      },
      document: {
        mime: [
          'text/plain',
          'application/pdf',
          'application/vnd.ms-powerpoint',
          'application/msword',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        maxKB: 100 * 1024,
      },
      image: {
        mime: ['image/jpeg', 'image/png'],
        maxKB: 5 * 1024,
      },
      video: {
        mime: ['video/mp4', 'video/3gp'],
        maxKB: 16 * 1024,
      },
      sticker: {
        mime: ['image/webp'],
        maxKB: 500,
      },
    },
    url: '',
    getType: (mime, size) => {
      for (let type in meta.fileManager.types) {
        for (let fileMime of meta.fileManager.types[type].mime) {
          if (mime == fileMime && size <= meta.fileManager.types[type].maxKB) {
            return type
          }
        }
      }
    },
    add: async (save, code, mime, data) => {
      const fileSize = parseInt(Buffer.byteLength(data) / 1024)
      const type = meta.fileManager.getType(mime, fileSize)
      if (save) {
        const formData = new FormData()
        formData.append('messaging_product', messaging_product)
        formData.append('file', data)
        const options = { headers: formData.getHeaders() }
        options.headers.Authorization = 'Bearer ' + meta.key
        const result = (
          await axios.post(
            'https://graph.facebook.com/' +
              messaging_version +
              '/' +
              meta.phoneNumberId +
              '/media',
            formData,
            options
          )
        ).data
        const mediaId = result && result.id ? result.id : null
        console.log('upload to meta file save', type, fileSize + 'KB', mediaId)
        return { id: mediaId }
      }
      meta.files[code] = {
        code,
        type,
        mime,
        data,
        expires: new Date().getTime() + FILE_EXPIRY_DELAY,
        link: meta.downloadFromURL + code,
      }
      return JSON.parse(JSON.stringify(meta.files[code]))
    },
    download: async (id) => {
      let localFileName = null
      try {
        const mediaResult = (
          await axios.get(
            'https://graph.facebook.com/' + messaging_version + '/' + id + '/',
            { headers: { Authorization: 'Bearer ' + meta.key } }
          )
        ).data
        if (mediaResult && mediaResult.url) {
          const fileBuffer = Buffer.from(
            (
              await axios.get(mediaResult.url, {
                responseType: 'arraybuffer',
                headers: { Authorization: 'Bearer ' + meta.key },
              })
            ).data,
            'binary'
          )
          localFileName =
            new Date().getTime() + '.' + (await mime(fileBuffer)).ext
          fs.writeFileSync(meta.downloadToDirectory + localFileName, fileBuffer)
        }
      } catch (e) {
        console.log(e)
      }
      return localFileName
    },
  },
  qrCodes: {
    create: async (text) =>
      (
        await axios.post(
          'https://graph.facebook.com/' +
            messaging_version +
            '/' +
            meta.phoneNumberId +
            '/message_qrdls?access_token=' +
            meta.key +
            '&prefilled_message=' +
            text +
            '&generate_qr_image=png'
        )
      ).data,
  },
}

module.exports = meta
