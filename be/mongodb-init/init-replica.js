// Wait for MongoDB to be ready
sleep = function (millis) {
  var date = new Date();
  var curDate = null;
  do {
    curDate = new Date();
  } while (curDate - date < millis);
};

print('Starting MongoDB replica set initialization...');

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
      members: [{ _id: 0, host: 'mongodb:27017', priority: 1 }],
    });
    print('Replica set initialized successfully');

    // Wait for replica set to become primary
    var attempts = 0;
    while (attempts < 30) {
      try {
        var status = rs.status();
        if (status.myState === 1) {
          print('Replica set is now PRIMARY');
          break;
        }
        print(
          'Waiting for replica set to become PRIMARY... attempt',
          attempts + 1,
        );
        sleep(1000);
        attempts++;
      } catch (e) {
        print('Waiting for replica set status... attempt', attempts + 1);
        sleep(1000);
        attempts++;
      }
    }
  } catch (initError) {
    print('Error initializing replica set:', initError);
  }
}

// Wait a bit more for the replica set to stabilize
sleep(3000);

// Create admin user if it doesn't exist
try {
  db = db.getSiblingDB('admin');
  try {
    var user = db.getUser('root');
    if (user) {
      print('Admin user already exists');
    }
  } catch (userError) {
    print('Creating admin user...');
    db.createUser({
      user: 'root',
      pwd: 'example',
      roles: [{ role: 'root', db: 'admin' }],
    });
    print('Admin user created successfully');
  }
} catch (error) {
  print('Error with admin user:', error);
}

print('MongoDB initialization completed');
