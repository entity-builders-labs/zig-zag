// Wait for MongoDB to be ready
sleep = function (millis) {
  var date = new Date();
  var curDate = null;
  do {
    curDate = new Date();
  } while (curDate - date < millis);
};

// Try to initiate the replica set
try {
  rs.initiate({
    _id: 'rs0',
    members: [{ _id: 0, host: 'mongodb:27017' }],
  });
  print('Replica set initialized successfully');
} catch (error) {
  print('Error initializing replica set:', error);
}

// Wait a bit for the replica set to initialize
sleep(5000);

// Create admin user if it doesn't exist
try {
  db = db.getSiblingDB('admin');
  if (!db.getUser('root')) {
    db.createUser({
      user: 'root',
      pwd: 'example',
      roles: [{ role: 'root', db: 'admin' }],
    });
    print('Admin user created successfully');
  } else {
    print('Admin user already exists');
  }
} catch (error) {
  print('Error creating admin user:', error);
}
