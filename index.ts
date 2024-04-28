import httpProxy from 'http-proxy';
import zlib from 'zlib'

import Koa from 'koa'
import Router from '@koa/router'

import { business } from './business';

const SERVER_ACCOUNT_MANAGER_URL = process.env.SERVER_ACCOUNT_MANAGER_URL
const SERVER_PROXY_URL = process.env.SERVER_PROXY_URL
const SERVER_PROXY_DOMAIN = process.env.SERVER_PROXY_DOMAIN

const SERVER_THIS_DOMAIN = process.env.SERVER_THIS_DOMAIN

const sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

const accountHolder = {
    newAuthorization: ''
}

const initAccount = async () => {

    // let resp = await business.fetchPassword(Object.assign({}, {host: process.env.SERVER_SSO_DOMAIN, 'x-forwarded-host': process.env.SERVER_SSO_DOMAIN, 'x-bfl-user': process.env.ACCOUNT_NAME}) )
    // if (resp.statusCode == 200 && resp.body.password != undefined && resp.body.password != '') {
    //     accountHolder.newAuthorization = `Basic ${btoa(`${process.env.ACCOUNT_NAME}:${resp.body.password}`)}` 
    // }
    accountHolder.newAuthorization = `Basic ${btoa(`${process.env.ACCOUNT_NAME}:${process.env.ACCOUNT_PASSWORD}`)}` 
}

initAccount()

const proxy = httpProxy.createProxyServer(
    {
        target: SERVER_PROXY_URL,
        headers: {
            host: SERVER_PROXY_DOMAIN as string,
        },
        selfHandleResponse: true
    }
).listen(8001);

function generateRandomString(length: number): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }
class Call {
    id: string
    pass: boolean | undefined = undefined

    constructor() {
        this.id = generateRandomString(8)
    }

    startCheck = async(authorization: string) => {

        try {
            await business.checkSystemPassword(authorization)
            this.pass = true
        } catch (error) {
            this.pass = false
        }

    }
}

let calls: Call[] = []

proxy.on('proxyReq', (proxyReq, req, res, options) => {
    
    console.group('proxyReq proxy')
    console.group('header')
    console.log(proxyReq.getHeaders())
    console.groupEnd()

    console.group('header req')
    console.log(req.headers)
    console.groupEnd()

    console.group('options')
    console.log(options.headers)
    console.groupEnd()

    if (proxyReq.getHeaders().authorization != undefined) {
        let oldAuthorization = proxyReq.getHeaders().authorization
        console.log('replease headers')
        console.log('accountHolder.newAuthorization', accountHolder.newAuthorization)
        proxyReq.setHeader('authorization', accountHolder.newAuthorization)
        req.headers.authorization = accountHolder.newAuthorization

        let call = new Call()
        call.startCheck(oldAuthorization as string)
        calls.push(call)
        proxyReq.setHeader('x-gitlab-cp-call', call.id)
    }

    req.headers.host = SERVER_PROXY_URL
    
    console.group('request')
    // let data = proxyReq.req.read()
    // console.log(data)
    console.groupEnd()

    console.groupEnd()
})

proxy.on('proxyRes', async (proxyRes, req, res) => {
    console.group('proxyRes proxy')
    console.log(proxyRes.statusCode)
    console.log(proxyRes.statusMessage)
    console.group('header')
    console.log(proxyRes.headers)
    console.groupEnd()
    console.group('req header')
    console.log(req.headers)
    console.groupEnd()
    
    let newHeader: {
        location: string | undefined
        Replace: boolean
    } = {
        // 'content-encoding': 'none'
        location: '',
        Replace: false
    }
    
    if (proxyRes.headers['x-frame-options']) {
        delete proxyRes.headers['x-frame-options'];
    }

    if (proxyRes.headers['x-gitlab-cp-call'] != undefined) {
        let callArr = calls.filter(c => c.id == proxyRes.headers['x-gitlab-cp-call'])
        calls = calls.filter(c => c.id != proxyRes.headers['x-gitlab-cp-call'])

        if (callArr.length > 0) {
            while (callArr[0].pass == undefined) {
                await sleep(100)
            }

            if (callArr[0].pass == false) {
                res.writeHead(401, 'username or password were error')
                res.end('')
                return
            }
        }

    }

    //reset local
    if (proxyRes.statusCode == 302) {
        // newHeader.location = proxyRes.headers.location?.replace(SERVER_PROXY_DOMAIN as string, SERVER_THIS_DOMAIN as string);
        let resp = await business.doSSO(Object.assign({}, req.headers, {host: process.env.SERVER_SSO_DOMAIN, 'x-forwarded-host': process.env.SERVER_SSO_DOMAIN}) )
        
        if (resp.headers['set-cookie'] == undefined) {
            res.writeHead(501, 'sync cookie failed', resp.headers)
            res.end(resp.body)            
            return
        } else {
            if (SERVER_THIS_DOMAIN == undefined) {
                throw new Error('not found SERVER_THIS_DOMAIN')
            }
            let newArr: string[] = []
            for (let setcookie of resp.headers['set-cookie'] as string[]) {

                let repleaseDoaminStart = setcookie.indexOf('domain')
                let repleaseDoaminEnd = setcookie.indexOf(';', repleaseDoaminStart)
                let ns = `${setcookie.substring(0, repleaseDoaminStart)} domain=${SERVER_THIS_DOMAIN};${setcookie.substring(repleaseDoaminEnd, setcookie.length)}` 
                ns = ns + ";secure=true;";
                newArr.push(ns)

                let domainThis: string[] = SERVER_THIS_DOMAIN.split('.') as string[]
                let localDomainThis: string[] = [domainThis[0], 'local', ...domainThis?.slice(1)]
                let nslocal = `${setcookie.substring(0, repleaseDoaminStart)} domain=${localDomainThis.join('.')};${setcookie.substring(repleaseDoaminEnd, setcookie.length)}` 
                nslocal = nslocal + ";secure=true;";
                newArr.push(nslocal)

            } 
            resp.headers['set-cookie'] = newArr

            //fetch password
            setTimeout(() => {
                initAccount()
            }, 100)
        }


        if (resp.statusCode == 302) {
            res.writeHead(resp.statusCode as number, resp.statusMessage, resp.headers)
            res.end(resp.body)
            return
        }

    }
    // else if (proxyRes.statusCode == 401 && req.headers.authorization != undefined){

    //     let a = req.headers.authorization.split(' ')
    //     if (a[0] == 'Basic') {
    //         let account = atob(a[1])
    //         let nameAndPassword = account.split(':')

    //         console.log('account', account)
    //         console.log('nameAndPassword', nameAndPassword)

    //         if (nameAndPassword.length > 1 && nameAndPassword[1] == 'gitlab') {
    //             // let resp = await business.fetchPassword(Object.assign({}, req.headers, {host: process.env.SERVER_SSO_DOMAIN, 'x-forwarded-host': process.env.SERVER_SSO_DOMAIN}) )
    //             // if (resp.statusCode == 200 && resp.body.password != undefined && resp.body.password != '') {
    //             //     let newAuthorization = `Basic ${btoa(`${nameAndPassword[0]}:resp.body.password`)}` 
    //             //     req.headers.authorization = newAuthorization

    //             //     console.log('recall')
    //             //     proxy.web(req, res)
    //             // }
    //         }
    //     }



    // } 
    else {
        newHeader.Replace = true
    }
    
    res.writeHead(proxyRes.statusCode ? proxyRes.statusCode : 404, proxyRes.statusMessage, Object.assign({}, proxyRes.headers, newHeader))

    let dataReady = false
    let body: any[] = [];
    
    
    
    proxyRes.on('data', function (chunk: any) {
        body.push(chunk);
    });
    proxyRes.on('end', function () {

        // zlib.inflate(Buffer.concat(body), (error, buf) => {
        //     console.log('error', error)
        //     console.log('buf', buf)

        //     let bodyStr = buf.toString('utf-8')
        //     console.group('request')
        //     console.log(bodyStr)
        //     console.log(body)
        //     console.groupEnd()
        // });

        
        // res.write("");
        res.write(Buffer.concat(body))
        res.end()
        // res.end("my response to cli");

        console.log('proxyRes on end')
        dataReady = true
    });

    while (!dataReady) {
        await sleep(100)
    }
    
    // res.write()
    // res.
    // res.write(0)
    // res.end("my response to cli")

    console.groupEnd()
})


const proxySSO = httpProxy.createProxyServer(
    {
        target: SERVER_ACCOUNT_MANAGER_URL,
        selfHandleResponse: true,
        headers: {
            'x-gitlab-password': process.env.ACCOUNT_PASSWORD as string,
            'x-bfl-user': process.env.ACCOUNT_NAME as string
        }
    }
).listen(8000);

proxySSO.on('proxyReq', async (proxyReq, req, res, options) => {
    
    console.group('proxyReq proxySSO')
    console.group('header')
    console.log(proxyReq.getHeaders())
    console.groupEnd()

    req.headers.host = SERVER_THIS_DOMAIN
    req.headers['x-gitlab-password'] = process.env.ACCOUNT_PASSWORD
    req.headers['x-bfl-user'] = process.env.ACCOUNT_NAME
    console.group('header req')
    console.log(req.headers)
    console.groupEnd()

    console.group('options')
    console.log(options.headers)
    console.groupEnd()

    // let reqInHeaders = proxyReq.getHeaders()
    // let user = reqInHeaders['x-bfl-user'] as string
    // let accesstoken = reqInHeaders['remote-accesstoken'] as string
    // let refreshtoken = reqInHeaders['remote-refreshtoken'] as string
    // let email = reqInHeaders['remote-email'] as string
    // if (user != undefined && accesstoken != undefined && refreshtoken != undefined) {
    //     await business.checkAndLogin(user, accesstoken, refreshtoken, email, reqInHeaders)
    // }
    
    console.group('request')
    // let data = proxyReq.req.read()
    // console.log(data)
    console.groupEnd()

    console.groupEnd()
})

proxySSO.on('proxyRes', async (proxyRes, req, res) => {
    console.group('proxyRes proxySSO')
    console.log(proxyRes.statusCode)
    console.log(proxyRes.statusMessage)
    console.group('header')
    console.log(proxyRes.headers)
    console.groupEnd()


    let newHeader: {
        location: string | undefined
    } = {
        // 'content-encoding': 'none'
        location: ''
    }
    //reset local
    if (proxyRes.statusCode == 302) {
        newHeader.location = proxyRes.headers.location?.replace(SERVER_PROXY_DOMAIN as string, SERVER_THIS_DOMAIN as string);
    }
    
    res.writeHead(proxyRes.statusCode ? proxyRes.statusCode : 404, proxyRes.statusMessage, Object.assign({}, proxyRes.headers, newHeader))

    let dataReady = false
    let body: any[] = [];
    
    
    proxyRes.on('data', function (chunk: any) {
        body.push(chunk);
    });
    proxyRes.on('end', function () {

        res.write(Buffer.concat(body))
        res.end()

        console.log('proxyRes on end')
        dataReady = true
    });

    while (!dataReady) {
        await sleep(100)
    }

    console.groupEnd()
})


