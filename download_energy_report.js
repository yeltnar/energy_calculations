#!/usr/bin/env node
// bail if we don't have our ENV set:
import fs from 'fs/promises';
import config from 'config';

async function download_energy_report(out_dir=`./in_csv`, num_results=3){

  if (!config.JMAP_TOKEN) {
    console.log("Please set your JMAP_USERNAME and JMAP_TOKEN");
    console.log("JMAP_USERNAME=username JMAP_TOKEN=token node hello-world.js");

    process.exit(1);
  }
  
  if (!config.num_results) {
    console.log("Please set your num_results environment variable");
    console.log("num_results=3 node hello-world.js");

    process.exit(1);
  }else{
    num_results = parseInt(config.num_results);
  }

  console.log(`using ${num_results} email results`);

  const jmap_token = config.JMAP_TOKEN;

  const hostname = config.JMAP_HOSTNAME || "api.fastmail.com";
  const username = config.JMAP_USERNAME;

  const authUrl = `https://${hostname}/.well-known/jmap`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${jmap_token}`,
  };

  const getSession = async () => {
    // should not cache 
    const response = await fetch(authUrl, {
      method: "GET",
      headers,
    });
    return response.json();
  };

  const inboxIdQuery = async (api_url, account_id) => {
    // should not cache 
    const response = await fetch(api_url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: [
          [
            "Mailbox/query",
            {
              accountId: account_id,
              filter: { role: "inbox", hasAnyRole: true },
            },
            "a",
          ],
        ],
      }),
    });

    const data = await response.json();

    const inbox_id = data["methodResponses"][0][1]["ids"][0];

    if (!inbox_id.length) {
      console.error("Could not get an inbox.");
      process.exit(1);
    }

    return await inbox_id;
  };

  const mailboxQuery = async (api_url, account_id, inbox_id, num_results=10) => {
    // should not cache
    const response = await fetch(api_url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: [
          [
            "Email/query",
            {
              accountId: account_id,
              filter: { 
                // inMailbox: inbox_id,
                from: "info@communications.smartmetertexas.com",
                hasAttachment: true
              },
              sort: [{ property: "receivedAt", isAscending: false }],
              limit: num_results,
            },
            "a",
          ],
          [
            "Email/get",
            {
              accountId: account_id,
              properties: ["id", "subject", "receivedAt", "attachments"],
              "#ids": {
                resultOf: "a",
                name: "Email/query",
                path: "/ids/*",
              },
            },
            "b",
          ],
          // [
          //   "Email/get",
          //   {
          //     accountId: account_id,
          //     // properties: ["id", "subject", "receivedAt", "attachments"],
          //     "#ids": {
          //       resultOf: "b",
          //       name: "Email/query",
          //       path: "/list/attachments/*/blobId",
          //     },
          //   },
          //   "c",
          // ]
        ],
      }),
    });

    const data = await response.json();

    return await data;
  };

  return await getSession().then(async(session) => {
    const api_url = session.apiUrl;
    const account_id = session.primaryAccounts["urn:ietf:params:jmap:mail"];
    // console.log({api_url,account_id});
    await inboxIdQuery(api_url, account_id).then(async(inbox_id) => {
      await mailboxQuery(api_url, account_id, inbox_id, num_results).then(async(emails) => {
        
        const to_wait = emails["methodResponses"][1][1]["list"].map(async (email) => {
          
          // download all the attachments 
          for ( let i=0; i<email.attachments.length; i++ ){
            const { blobId, name, type }=email.attachments[i];            
            await downloadFile({ account_id, blobId, name, type, out_dir });
          }
        });
        await Promise.all(to_wait);
      });
    });
  });

  async function downloadFile({ account_id, blobId, name, type, out_dir }){
    
    const out_path = `${out_dir}/${name}`;

    // Test if file is ther, otherwise download it 
    try{
      const saved_file = await fs.readFile(out_path);
      // console.log(`file \'${out_path}\' found; not downloading`);
      return saved_file.toString();
      
    }catch(e){
      console.log(`file \'${name}\' NOT found; downloading`);
    }

    const download_url = `https://www.fastmailusercontent.com/jmap/download/${account_id}/${blobId}/${name}?type=${type}`;

    const bearer_token = jmap_token;

    const headers = {
      'content-type':'application/json',
      'Authorization':`Bearer ${bearer_token}`
    }

    // TODO change to cached request
    const response = await fetch(download_url, {
      method: "POST",
      headers,
    });

    const attachment_content = await response.text();

    // console.log({out_path});
    await fs.writeFile( out_path, attachment_content );

    return attachment_content;

  }
}

export default download_energy_report;
