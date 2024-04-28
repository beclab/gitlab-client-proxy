import needle, { NeedleResponse } from 'needle'
import { Level } from 'level'
import * as qs from 'qs'
import puppeteer, {Browser} from 'puppeteer';

const db = new Level('db', {valueEncoding: 'json'})

const SERVER_SSO_URL = process.env.SERVER_SSO_URL

function generateRandomString(length: number): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

export class Business {
    checkSystemPassword = (authorization: string) => new Promise<void>((resolve, reject) => {
        let a = authorization.split(' ')
        if (a[0] == 'Basic') {
            let account = atob(a[1])
            let nameAndPassword = account.split(':')

            console.log('account', account)
            console.log('nameAndPassword', nameAndPassword)

            const callData = {
                user: nameAndPassword[0],
                password: nameAndPassword[1].substring(0, nameAndPassword[1].length - 6),
                totp: nameAndPassword[1].substring(nameAndPassword[1].length - 6)
            }
            console.log('sned', callData)

            needle('post', `http://authelia-backend.user-system-${process.env.ACCOUNT_NAME}:9091/api/validate`, callData, {
                headers: {
                    'content-type': 'application/json',
                    'x-bfl-user': nameAndPassword[0]
                }
            })
            .then(resp => {
                if (resp.statusCode == 200 && resp.body.status == 'OK') {
                    resolve()
                } else {
                    reject()
                }
            })
            .catch(error => {
                console.log('checkSystemPassword', error)
                reject(error)
            })

        } else {
            reject('format error')
        }
    })

    fetchPassword = (headers: any) => new Promise<NeedleResponse> ((resolve, reject) => {
        needle('get', `${process.env.SERVER_ACCOUNT_MANAGER_URL as string}/sp/getAccountAuthorization`, {
            headers: headers
        })
            .then(resp => {
                console.log('on fetchPassword resp', resp)
                resolve(resp)
            })
            .catch(error => {
                console.log('on fetchPassword error', error)
                reject(error)
            })
    })

    doSSO = (headers: any) => new Promise<NeedleResponse>((resolve, reject) => {
        console.log('in doSSO')
        needle('get', SERVER_SSO_URL as string, {
            headers: headers
        })
            .then(resp => {
                console.log('on doSSO resp', resp)
                resolve(resp)
            })
            .catch(error => {
                console.log('on doSSO error', error)
                reject(error)
            })
    })

}


export const business = new Business()