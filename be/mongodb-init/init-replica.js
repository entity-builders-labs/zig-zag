// Wait for MongoDB to be ready
sleep = function (millis) {
  var date = new Date();
  var curDate = null;
  do {
    curDate = new Date();
  } while (curDate - date < millis);
};

print('Starting MongoDB replica set initialization...');

// Wait a bit for MongoDB to be ready
sleep(5000);

// Get environment variables
var database = process.env.MONGODB_DATABASE;
var rootUser = process.env.MONGO_INITDB_ROOT_USERNAME;
var rootPassword = process.env.MONGO_INITDB_ROOT_PASSWORD;

print('Environment variables loaded');
print('Database:', database);

// First, authenticate as root to initialize replica set
db = db.getSiblingDB('admin');

// Try to initiate the replica set
try {
  // Check if replica set is already initialized
  var status = rs.status();
  print('Replica set already initialized:', status.set);
} catch (error) {
  print('Replica set not initialized, initializing now...');
  try {
    rs.initiate({
      _id: 'rs0',
      members: [
        { 
          _id: 0, 
          host: 'mongodb:27017',
          priority: 1,
          votes: 1
        }
      ]
    });
    print('Replica set initialized successfully');

    // Wait for replica set to become primary
    var attempts = 0;
    while (attempts < 30) {
      try {
        var status = rs.status();
        if (status.ok === 1 && status.myState === 1) {
          print('Replica set is now PRIMARY');
          break;
        }
        print('Waiting for replica set to become PRIMARY... attempt', attempts + 1);
        sleep(2000);
        attempts++;
      } catch (e) {
        print('Waiting for replica set status... attempt', attempts + 1);
        sleep(2000);
        attempts++;
      }
    }

    // Create root user if it doesn't exist
    try {
      db.createUser({
        user: rootUser,
        pwd: rootPassword,
        roles: [
          { role: 'root', db: 'admin' },
          { role: 'dbOwner', db: database }
        ]
      });
      print('Root user created successfully');
    } catch (userError) {
      if (userError.code === 51003) {
        print('Root user already exists');
      } else {
        throw userError;
      }
    }
  } catch (initError) {
    print('Error initializing replica set:', initError);
  }
}

print('MongoDB replica set initialization completed');