import {main} from './single_run.js';
import {server} from './server.js';
import config from 'config';

if( config.start_server === true || process.env.start_server === 'true' ){
  console.log('server selected');
  server();
}else{
  console.log('oneshot selected');
  /*await*/ main({write:true})
}