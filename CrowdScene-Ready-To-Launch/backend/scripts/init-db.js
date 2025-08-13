import Database from 'better-sqlite3'; const db=new Database('./crowdscene.db'); db.exec('VACUUM;'); console.log('DB ready');
