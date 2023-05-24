const express = require("express");
const bodyparser = require("body-parser");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql");
const multer = require("multer");
const csv = require("fast-csv");
const cors = require("cors");
const e = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require('cookie-parser');
require("dotenv").config();

const app = express();
app.use(express.static("./public"));
app.use(cors());

app.use(bodyparser.json());
app.use(
  bodyparser.urlencoded({
    extended: true,
  })
);

app.use(cookieParser());

const usersDB = {
  users: require('./model/users.json'),
  setUsers: function (data) {this.users = data}
}

const fsPromises = require('fs').promises;

app.use("/uploads", express.static("./uploads"));

var storage = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./uploads/");
  },
  filename: (req, file, callBack) => {
    callBack(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});

var imgconfig = multer.diskStorage({
  destination: (req, file, callBack) => {
    callBack(null, "./uploads/");
  },
  filename: (req, file, callBack) => {
    callBack(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});

const isImage = (req, file, callBack) => {
  if (file.mimetype.startsWith("image")) {
    callBack(null, true);
  } else {
    callBack(null, Error("Only images allowed"));
  }
};

const isCsv = (req, file, callBack) => {
  if (file.mimetype.startsWith("csv")) {
    callBack(null, true);
  } else {
    callBack(null, Error("Only csv files allowed"));
  }
};

var upload = multer({
  storage: storage,
  fileFilter: isCsv,
});

var imageUpload = multer({
  storage: imgconfig,
  fileFilter: isImage,
});

const db = mysql.createConnection({
  user: "root",
  host: "localhost",
  password: "secureD@t@b@se0913",
  database: "exchange_rate_app_db",
});

db.connect((error) => {
  if (error) {
    console.log(error);
  } else {
    console.log("MySQL Connected...");
  }
});

app.post("/import-csv", upload.single("import-csv"), (req, res) => {
  console.log(req.file.filename);
  try {
    uploadCsv(__dirname + "/uploads/" + req.file.filename);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false });
  }
});

app.get("/umbrate", (req, res) => {
  db.query(
    "SELECT * FROM exhange_rates WHERE rate_type='UMB_RATE'",
    (err, result) => {
      if (err) {
        console.log(err);
      } else {
        res.send(result);
      }
    }
  );
});

app.get("/intrate", (req, res) => {
  db.query(
    "SELECT * FROM exhange_rates WHERE rate_type='INT_RATE'",
    (err, result) => {
      if (err) {
        console.log(err);
      } else {
        res.send(result);
      }
    }
  );
});

app.get("/getImages", (req, res) => {
  db.query("SELECT * FROM images", (err, result) => {
    if (err) {
      console.log(err);
    } else {
      res.send(result);
    }
  });
});


const handleNewUser = async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  if (!username || !password)
    return res
      .status(400)
      .json({ message: "Username and password are required" });

  // db.query("SELECT username FROM users WHERE username = ?", [username], (err, result) => {
  //   const duplicate = result;
  //   console.log(duplicate)
  // if(duplicate.username) return res.sendStatus(409);
  // })

  const duplicate = usersDB.users.find(person => person.username === username);
  if (duplicate) return res.sendStatus(409);

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // let query = "INSERT INTO users SET ?";

    // db.query(query, { username: username, password: hashedPassword });
    const newUser = { "username": username, "password": hashedPassword };
    usersDB.setUsers([...usersDB.users, newUser]);
    await fsPromises.writeFile(
      path.join(__dirname, '.', 'model', 'users.json'),
      JSON.stringify(usersDB.users)
    );
    res.status(201).json({ 'success': `New user ${username} created!`})
  } catch (err) {
    res.status(500).json({ 'message' : err.message });
  }
};

const handleLogin = async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  if (!username || !password)
    return res
      .status(400)
      .json({ message: "Username and password are required" });


  const foundUser = usersDB.users.find(person => person.username === username);
  if (!foundUser) return res.sendStatus(401);
  // const db = mysql.createConnection({
  //   user: "root",
  //   host: "localhost",
  //   password: "secureD@t@b@se0913",
  //   database: "exchange_rate_app_db",
  // });

  // const foundUser = db.query("SELECT password FROM users WHERE username = ?", [
  //   username,
  // ]);
  // if (!foundUser) return res.sendStatus(401);

  const match = await bcrypt.compare(password, foundUser.password);

  if (match) {
    const accessToken = jwt.sign(
      { username: username },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "1m" }
    );
    const refreshToken = jwt.sign(
      { username: username },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "1h" }
    );
    
    const otherUsers = usersDB.users.filter(person => person.username !== foundUser.username);
    const currentUser = { ...foundUser, refreshToken };
    usersDB.setUsers([...otherUsers, currentUser]);
    await fsPromises.writeFile(
      path.join(__dirname, '.', 'model', 'users.json'),
      JSON.stringify(usersDB.users)
    );
    res.cookie("jwt", refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: "None",
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.json({ accessToken });
  } else {
    res.sendStatus(401);
  }
};

const handleRefreshToken = (req, res) => {
  const cookies = req.cookies

  if (!cookies?.jwt) return res.status(401);
  console.log(cookies.jwt)
  const refreshToken = cookies.jwt;

  const foundUser = usersDB.users.find(person => person.refreshToken === refreshToken);
  if (!foundUser) return res.sendStatus(403);

  jwt.verify(
    refreshToken,
    process.env.REFRESH_TOKEN_SECRET,
    (err, decoded) => {
      if(err || foundUser.username !== decoded.username) return res.sendStatus(403);
      const accessToken = jwt.sign(
        { "username": decoded.username },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: '15m' }
      );
      res.json({ accessToken })
    }
  )
};

const handleLogout = async (req, res) => {
  const cookies = req.cookies

  if (!cookies?.jwt) return res.sendStatus(204);
  const refreshToken = cookies.jwt;

  const foundUser = usersDB.users.find(person => person.refreshToken === refreshToken);
  if (!foundUser) {
    res.clearCookie('jwt', { httpOnly: true })
    return res.sendStatus(403);
  }

  const otherUsers = usersDB.users.filter(person => person.refreshToken !== foundUser.refreshToken);
  const currentUser = {...foundUser, refreshToken: ''};
  usersDB.setUsers([...otherUsers, currentUser]);
  await fsPromises.writeFile(
    path.join(__dirname, '.', 'model', 'users.json'),
    JSON.stringify(usersDB.users)
  );

  res.clearCookie('jwt', { httpOnly: true, sameSite: 'None', secure: true });
  res.sendStatus(204);
};


const verifyJWT = (req, res, next) => {
  const authHeader = req.headers["Authorization"];
  if (!authHeader) return res.sendStatus(401);
  console.log(authHeader);
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) return res.sendStatus(403);
    req.username = decoded.username;
    next();
  });
};

app.post("/register", handleNewUser);

app.post("/login", handleLogin);
app.get("/refresh", handleRefreshToken);
app.get("/logout", handleLogout);

app.delete("/:id", (req, res) => {
  const { id } = req.params;
  try {
    db.query(`DELETE FROM images WHERE id = '${id}'`, (err, result) => {
      if (err) {
        console.log(err);
      } else {
        console.log("data deleted");
        res.status(201).json({ status: 201, data: result });
      }
    });
  } catch (error) {
    res.status(422).json({ status: 422, error });
  }
});

app.put("/makeactive", (req, res) => {
  const id = req.body.id;
  const status = req.body.status;
  try {
    db.query(
      `UPDATE images SET status = '${status}' WHERE id = '${id}'`,
      (err, result) => {
        if (err) {
          console.log(err);
        } else {
          console.log("data updated");
          res.status(201).json({ status: 201, data: result });
        }
      }
    );
  } catch (error) {
    res.status(422).json({ status: 422, error });
  }
});

app.post("/images", upload.single("photo"), (req, res) => {
  const { mediaType } = req.body;
  const { filename } = req.file;
  let intervalLength = 5000;

  if (!mediaType || !filename) {
    res.status(422).json({
      status: 422,
      message: "Check all fields are accounted for",
    });
  }

  try {
    let query = "INSERT INTO images SET ?";
    let status = "ACTIVE";

    if (mediaType === "video") {
      const { getVideoDurationInSeconds } = require("get-video-duration");

      // From a local path...
      getVideoDurationInSeconds(`./uploads/${filename}`).then((duration) => {
        intervalLength = duration * 1000;

        db.query(
          query,
          {
            img: filename,
            mediaType: mediaType,
            interval: intervalLength,
            status: status,
          },
          (err, result) => {
            if (err) {
              console.log(err);
            } else {
              console.log("success");
              res.status(201).json({
                status: 201,
                data: req.body,
              });
            }
          }
        );
      });
    } else {
      db.query(
        query,
        {
          img: filename,
          mediaType: mediaType,
          interval: intervalLength,
          status: status,
        },
        (err, result) => {
          if (err) {
            console.log(err);
          } else {
            console.log("success");
            res.status(201).json({
              status: 201,
              data: req.body,
            });
          }
        }
      );
    }
  } catch (error) {
    res.status(422).json({
      status: 422,
      error,
    });
  }
});

function uploadCsv(uriFile) {
  let stream = fs.createReadStream(uriFile);
  let csvDataColl = [];
  let fileStream = csv
    .parse()
    .on("data", function (data) {
      csvDataColl.push(data);
    })
    .on("end", function () {
      csvDataColl.shift();

      let query =
            "INSERT INTO exhange_rates (currency, bid, offer, rate_type, flags, date) VALUES ?";
          let delQuery = "DELETE FROM exhange_rates";
          db.query(delQuery, (error, res) => {
            console.log(error || res);
          });
          db.query(query, [csvDataColl], (error, res) => {
            console.log(error || res);
          });

      fs.unlinkSync(uriFile);
    });

  stream.pipe(fileStream);
}

const PORT = process.env.PORT || 5555;
app.listen(PORT, () => console.log(`Node app serving on port: ${PORT}`));
