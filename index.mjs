import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import session from 'express-session';

const app = express();
app.set('json spaces', 2);

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
        req.session.userID = rows[0]['User ID'];
        req.session.username = username;
        
        res.redirect('/');
    } else {
        res.render('login.ejs', { error: 'Invalid username or password' });
    }
});

app.get('/newUser', (req, res) => {
    res.render('newUser.ejs');
})

app.post('/createUser', async (req, res) => {
    let username = req.body.username.trim();
    let password = req.body.password;
    let confirmPassword = req.body.confirmPassword;

    // Check for empty fields
    if (!username || !password || !confirmPassword) {
        return res.render('newUser.ejs', {
            error: 'All fields are required'
        });
    }

    // Check if passwords match
    if (password !== confirmPassword) {
        return res.render('newUser.ejs', {
            error: 'Passwords do not match'
        });
    }

    try {
        let createUserSql = 'INSERT INTO Account_Information (`User Name`, Password) VALUES (?, ?)';

        let hashedPassword = await bcrypt.hash(password, 10);
        let params = [username, hashedPassword];

        await pool.query(createUserSql, params);

        res.redirect('/login');

    } catch (err) {
        // Check for multiple username entries
        if (err.code === 'ER_DUP_ENTRY') {
            return res.render('newUser.ejs', {
                error: 'Username already exists'
            });
        }
        console.error(err);
        res.status(500).render('newUser.ejs', {
            error: 'Unable to create account'
        });
    }
});

app.get('/recipeList', isUserAuthenticated, async (req, res) => {
    
    let query = 'SELECT * FROM Recipes';
    const [rows] = await pool.query(query);
    console.log(rows);
    
    res.render('recipe.ejs', {recipes: rows});
})
app.get('/api/recipes', isUserAuthenticated, async (req, res) => {

    let search = req.query.search || '';

    try {
        let url = `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(search)}`;

        let response = await fetch(url);

        if (!response.ok) {
            throw new Error('API request failed');
        }

        let data = await response.json();

        let recipes = (data.meals || []).map(meal => {
    let ingredients = [];

    for (let i = 1; i <= 20; i++) {
        let ingredient = meal[`strIngredient${i}`];
        let measure = meal[`strMeasure${i}`];

        if (ingredient && ingredient.trim()) {
            ingredients.push({
                name: ingredient.trim(),
                measure: measure ? measure.trim() : ''
            });
        }
    }

    return {
        id: meal.idMeal,
        name: meal.strMeal,
        category: meal.strCategory,
        area: meal.strArea,
        image: meal.strMealThumb,
        instructions: meal.strInstructions,
        ingredients: ingredients
    };
});

app.get('/api/recipes/:id', isUserAuthenticated, async (req, res) => {

    let id = req.params.id;

    try {
        let url = `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(id)}`;

        let response = await fetch(url);

        if (!response.ok) {
            throw new Error('API request failed');
        }

        let data = await response.json();

        if (!data.meals || data.meals.length === 0) {
            return res.status(404).json({
                error: 'Recipe not found'
            });
        }

        res.json(data.meals[0]);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: 'Unable to retrieve recipe'
        });
    }
});

res.json(recipes);

    } catch (err) {
        console.error('TheMealDB API error:', err);

        res.status(500).json({
            error: 'Unable to retrieve recipes'
        });
    }
});


app.get('/logout', isUserAuthenticated, (req, res) => {

    req.session.destroy(err => {

        if (err) {
            return res.status(500).send('Unable to log out');
        }

        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

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