import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import session from 'express-session';

const app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));

//for Express to get values using the POST method
app.use(express.urlencoded({extended:true}));

//setting up database connection pool, replace values in red
const pool = mysql.createPool({
    host: "zy4wtsaw3sjejnud.cbetxkdyhwsb.us-east-1.rds.amazonaws.com",
    user: "fmv5jh0k6k6pzd6y",
    password: "iehybhu5y7tdtv1d",
    database: "m1bd7h6mj5paxvrm",
    connectionLimit: 10,
    waitForConnections: true
});

// initialize this server app to use sessions
app.set('trust proxy', 1); // trust first proxy
app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));

//routes
app.get('/', isUserAuthenticated, (req, res) => {
  res.render('home.ejs');
});

// Login routes

app.get('/login', (req, res) => {
  res.render('login.ejs');
});

app.post('/login', async (req, res) => {

    // Retrieving the entered username and password from the form
    let username = req.body.username;
    let password = req.body.password;

    // Select the user that matches the username typed in the form
    let checkUserQuery = 'SELECT * FROM Account_Information WHERE `User Name` = ?';

    let params = [username];
    let [rows] = await pool.query(checkUserQuery, params);

    // if no user is found, we know they typed in the wrong username
    if (rows.length > 0 && await bcrypt.compare(password, rows[0].Password)) {
        
        req.session.authenticated = true;
        req.session.role = 'admin';
        req.session.username = username;
        
        res.render('home.ejs');
    } else {
        res.render('login.ejs', { error: 'Invalid username or password' });
    }
});

// New user routes

app.get('/newUser', (req, res) => {
    res.render('newUser.ejs');
})

app.post('/createUser', async (req, res) => {
    let username = req.body.username;
    let password = req.body.password;

    let createUserSql = 'INSERT INTO Account_Information (`User Name`, Password) VALUES (?, ?)';
    
    let hashedPassword = await bcrypt.hash(password, 10);

    let params = [username, hashedPassword];

    const [rows] = await pool.query(createUserSql, params);

    res.redirect('/login');

});

// Recipe routes

app.get('/recipeList', isUserAuthenticated, async (req, res) => {
    
    let query = 'SELECT * FROM Recipes';
    const [rows] = await pool.query(query);
    console.log(rows);
    
    res.render('recipe.ejs', {recipes: rows});
})

app.get('/newRecipe', isUserAuthenticated, async (req, res) => {
    res.render('newRecipe.ejs');
})

// Logout route

app.get('/logout', isUserAuthenticated, async (req, res) => {
    // Destroy the session and redirect to login page

    req.session.destroy(callback => {
        // callback is what happens after the session is destroyed
        res.redirect('/login');
    });
})

app.get("/dbTest", async(req, res) => {
  try {
        const [rows] = await pool.query("SELECT CURDATE()");
        res.send(rows);
    } catch (err) {
        console.error("Database error:", err);
        res.status(500).send("Database error!");
    }
});//dbTest

app.listen(3000, ()=>{
    console.log("Express server running")
});


//middleware function to check if user is authenticated
function isUserAuthenticated(req, res, next) {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}