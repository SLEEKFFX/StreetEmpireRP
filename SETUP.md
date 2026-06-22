# Street Empire RP – Setup Guide

## Requirements
- Node.js **v18 or higher** (`node --version` to check)
- npm
- whatsapp
- bot hosting platform with atleast 1gb ram and a reliable cpu speed (optiklink recommended)

## First Time Setup
(termux or other similar consoles)
```bash
# 1. Install dependencies
npm install

# 2. Start the bot
npm start
```
(bothosting sites)

1. Upload the zip file State Empire RP.zip 
2. unarchive
3. delete zip file (not mandatory)
4. click the exracted folder 
5. select all the files
6. click move then input ../ in the box above
7. go to your console
8. click start
9. link device 
10. enjoy

On first launch you will be asked:
- **Option 1 – QR Code**: Scan with WhatsApp (WhatsApp → Settings → Linked Devices → Link a Device)
- **Option 2 – Pair Code**: Enter your phone number, then enter the code shown on your terminal into WhatsApp (Linked Devices → Link with phone number)

## Reconnecting
If already authenticated, the bot reconnects automatically using the saved `auth_info_baileys/` session.

## Reset / Re-link
Delete the `auth_info_baileys/` folder and restart:
```bash
rm -rf auth_info_baileys/
npm start (for termux)
```
Simply click start or restart for bot hosting (optiklink)
## Troubleshooting
- **`Cannot find module` errors** → Run `npm install` first
- **QR not showing** → Make sure your terminal supports unicode/box characters
- **Logged out error** → Delete `auth_info_baileys/` and re-link
- **Node version error** → Upgrade to Node.js 18+ from https://nodejs.org
