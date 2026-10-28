# autobrowse: system

Browser and account automation; the desk worker on the Mac

## Calls

- autobrowse → platforms (calls): post and read
- autobrowse → ssm (calls): tokens and credentials
- autobrowse → credvault (uses): the credentials library on npm: sealed store, audit, expiries
  - here: `../autobrowse/src/owner.ts`
  - there: `../credvault/src/env-store.ts`
