
import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import session from 'express-session';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load database credentials
if (existsSync('.env')) process.loadEnvFile('.env');

const app = express();

app.set('json spaces', 2);
app.set('view engine', 'ejs');

app.use(express.static('public', { index: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '32kb' }));

app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});


// DATABASE CONNECTION

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 10,
    waitForConnections: true
});


// SESSION SETTINGS

app.set('trust proxy', 1);

app.use(session({
    secret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
}));


// HOME PAGE

app.get('/', isUserAuthenticated, (req, res) => {
    res.render('home.ejs');
});
// LOGIN

app.get('/login', (req, res) => {
    res.render('login.ejs');
});

app.post('/login', async (req, res) => {

    let username = typeof req.body?.username === 'string'
        ? req.body.username.trim() : '';

    let password = typeof req.body?.password === 'string'
        ? req.body.password : '';

    // Validate login fields
    if (!username || !password || Buffer.byteLength(password, 'utf8') > 72) {
        return res.render('login.ejs', {
            error: 'Invalid username or password'
        });
    }

    try {

        let query = 'SELECT * FROM Account_Information WHERE `User Name` = ?';

        let [rows] = await pool.query(query, [username]);

        if (rows.length === 0 || !await bcrypt.compare(password, rows[0].Password)) {

            return res.render('login.ejs', {
                error: 'Invalid username or password'
            });
        }

        // Generate a new session after successful login
        await new Promise((resolve, reject) => {
            req.session.regenerate(err => err ? reject(err) : resolve());
        });

        req.session.authenticated = true;
        req.session.userID = rows[0]['User Id'];
        req.session.username = rows[0]['User Name'];

        // Save session before redirecting
        await new Promise((resolve, reject) => {
            req.session.save(err => err ? reject(err) : resolve());
        });

        res.redirect('/');

    } catch (err) {

        console.error('Login error:', err.code || err.message);

        res.status(500).render('login.ejs', {
            error: 'Unable to log in'
        });
    }
});


// ACCOUNT REGISTRATION

app.get('/newUser', (req, res) => {
    res.render('newUser.ejs');
});

app.post('/createUser', async (req, res) => {

    let username = typeof req.body?.username === 'string'
        ? req.body.username.trim() : '';

    let password = typeof req.body?.password === 'string'
        ? req.body.password : '';

    let confirmPassword = typeof req.body?.confirmPassword === 'string'
        ? req.body.confirmPassword : '';

    // Check for empty fields
    if (!username || !password.trim() || !confirmPassword.trim()) {

        return res.render('newUser.ejs', {
            error: 'All fields are required'
        });
    }

    // Check maximum bcrypt password length
    if (Buffer.byteLength(password, 'utf8') > 72) {

        return res.render('newUser.ejs', {
            error: 'Password is too long (maximum 72 bytes)'
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

        // Check for duplicate usernames
        if (err.code === 'ER_DUP_ENTRY') {

            return res.render('newUser.ejs', {
                error: 'Username already exists'
            });
        }

        console.error(err.code || err.message);

        res.status(500).render('newUser.ejs', {
            error: 'Unable to create account'
        });
    }
});


// DATABASE RECIPE LIST

app.get('/recipeList', isUserAuthenticated, async (req, res) => {

    try {

        const [rows] = await pool.query('SELECT * FROM Recipes');

        res.render('recipe.ejs', {
            recipes: rows
        });

    } catch (err) {

        console.error('Recipe list error:', err.code || err.message);

        res.status(500).send('Unable to retrieve database recipes');
    }
});


// GET CURRENT LOGGED-IN USER

app.get('/api/me', isUserAuthenticated, (req, res) => {

    res.json({
        username: req.session.username,
        userID: req.session.userID ?? null
    });
});


// SEARCH RECIPES STORED IN OUR DATABASE

app.get('/api/local-recipes', isUserAuthenticated, async (req, res) => {

    let search = req.query.search ?? '';

    if (typeof search !== 'string' || search.length > 200) {

        return res.status(400).json({
            error: 'Invalid search'
        });
    }

    try {

        let query = `
            SELECT \`Recipe Name\` AS name
            FROM Recipes
            WHERE LOCATE(?, \`Recipe Name\`) > 0
            ORDER BY \`Recipe Name\`
            LIMIT 100
        `;

        let [rows] = await pool.query(query, [search.trim()]);

        res.json(rows);

    } catch (err) {

        console.error('Local recipe search error:', err.code || err.message);

        res.status(500).json({
            error: 'Unable to retrieve database recipes'
        });
    }
});


// INDEPENDENT BACKEND TESTING PAGE

app.get('/backend-test', isUserAuthenticated, (req, res) => {

    res.sendFile(
        fileURLToPath(new URL('./backend-test.html', import.meta.url))
    );
});


// EXTERNAL API HELPER

async function fetchMeals(endpoint, params = {}) {

    let url = new URL(
        `https://www.themealdb.com/api/json/v1/1/${endpoint}`
    );

    url.search = new URLSearchParams(params).toString();

    let response = await fetch(url, {
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {

        throw new Error(`TheMealDB returned ${response.status}`);
    }

    let data = await response.json();

    // Verify the external API returned the expected data
    if (
        !data ||
        !Object.hasOwn(data, 'meals') ||
        (data.meals !== null && !Array.isArray(data.meals))
    ) {
        throw new Error('Unexpected TheMealDB response');
    }

    return data;
}


// EXTERNAL API ERROR HANDLING

function apiError(res, err) {

    console.error('TheMealDB error:', err.message);

    res.status(502).json({
        error: 'Unable to retrieve recipes from TheMealDB'
    });
}


// FORMAT BASIC RECIPE INFORMATION

function formatSummary(meal) {

    return {
        id: meal.idMeal,
        name: meal.strMeal,
        image: meal.strMealThumb
    };
}


// FORMAT FULL RECIPE INFORMATION

function formatRecipe(meal) {

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
}


// SEARCH EXTERNAL RECIPES BY NAME

app.get('/api/recipes', isUserAuthenticated, async (req, res) => {

    let search = req.query.search ?? '';

    if (typeof search !== 'string' || search.length > 200) {

        return res.status(400).json({
            error: 'Invalid search'
        });
    }

    try {

        let data = await fetchMeals('search.php', {
            s: search.trim()
        });

        let recipes = (data.meals || []).map(formatRecipe);

        res.json(recipes);

    } catch (err) {

        apiError(res, err);
    }
});


// REUSABLE RECIPE FILTER FUNCTION

async function filterRecipes(req, res, queryName, apiParam) {

    let value = req.query[queryName];

    if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > 200
    ) {

        return res.status(400).json({
            error: `${queryName[0].toUpperCase()}${queryName.slice(1)} is required`
        });
    }

    try {

        value = value.trim();

        // Format ingredients containing spaces
        if (queryName === 'ingredient') {

            value = value.replace(/\s+/g, '_');
        }

        let data = await fetchMeals('filter.php', {
            [apiParam]: value
        });

        let recipes = (data.meals || []).map(formatSummary);

        res.json(recipes);

    } catch (err) {

        apiError(res, err);
    }
}


// FILTER BY CATEGORY

app.get('/api/recipes/category', isUserAuthenticated, (req, res) => {

    return filterRecipes(req, res, 'category', 'c');
});


// FILTER BY INGREDIENT

app.get('/api/recipes/ingredient', isUserAuthenticated, (req, res) => {

    return filterRecipes(req, res, 'ingredient', 'i');
});


// FILTER BY COUNTRY OR REGION

app.get('/api/recipes/area', isUserAuthenticated, (req, res) => {

    return filterRecipes(req, res, 'area', 'a');
});


// GET AVAILABLE CATEGORIES

app.get('/api/categories', isUserAuthenticated, async (req, res) => {

    try {

        let data = await fetchMeals('list.php', {
            c: 'list'
        });

        let categories = (data.meals || []).map(meal => meal.strCategory);

        res.json(categories);

    } catch (err) {

        apiError(res, err);
    }
});


// GET AVAILABLE INGREDIENTS

app.get('/api/ingredients', isUserAuthenticated, async (req, res) => {

    try {

        let data = await fetchMeals('list.php', {
            i: 'list'
        });

        let ingredients = (data.meals || []).map(meal => meal.strIngredient);

        res.json(ingredients);

    } catch (err) {

        apiError(res, err);
    }
});


// GET AVAILABLE COUNTRIES OR REGIONS

app.get('/api/areas', isUserAuthenticated, async (req, res) => {

    try {

        let data = await fetchMeals('list.php', {
            a: 'list'
        });

        let areas = (data.meals || []).map(meal => meal.strArea);

        res.json(areas);

    } catch (err) {

        apiError(res, err);
    }
});


// GET RANDOM RECIPE

app.get('/api/recipes/random', isUserAuthenticated, async (req, res) => {

    try {

        let data = await fetchMeals('random.php');

        if (!data.meals?.length) {

            return res.status(404).json({
                error: 'Recipe not found'
            });
        }

        res.json(formatRecipe(data.meals[0]));

    } catch (err) {

        apiError(res, err);
    }
});


// GET INDIVIDUAL RECIPE BY ID
// Keep below all other recipe API routes

app.get('/api/recipes/:id', isUserAuthenticated, async (req, res) => {

    let id = req.params.id;

    if (!/^\d+$/.test(id)) {

        return res.status(400).json({
            error: 'Invalid recipe ID'
        });
    }

    try {

        let data = await fetchMeals('lookup.php', {
            i: id
        });

        if (!data.meals?.length) {

            return res.status(404).json({
                error: 'Recipe not found'
            });
        }

        res.json(formatRecipe(data.meals[0]));

    } catch (err) {

        apiError(res, err);
    }
});


// LOGOUT

app.get('/logout', isUserAuthenticated, (req, res) => {

    req.session.destroy(err => {

        if (err) {

            return res.status(500).send('Unable to log out');
        }

        res.clearCookie('connect.sid');

        res.redirect('/login');
    });
});


// DATABASE CONNECTION TEST

app.get('/dbTest', async (req, res) => {

    try {

        const [rows] = await pool.query('SELECT CURDATE()');

        res.send(rows);

    } catch (err) {

        console.error('Database error:', err);

        res.status(500).send('Database error!');
    }
});


// HANDLE INVALID API ROUTES

app.use('/api', (req, res) => {

    res.status(404).json({
        error: 'API endpoint not found'
    });
});


// AUTHENTICATION MIDDLEWARE

function isUserAuthenticated(req, res, next) {

    if (req.session.authenticated) {

        next();

    } else if (req.path.startsWith('/api/')) {

        res.status(401).json({
            error: 'Login required'
        });

    } else {

        res.redirect('/login');
    }
}


// START SERVER

app.listen(3000, () => {

    console.log('Express server running');
});
