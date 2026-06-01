# Learning Guide — Angular + Node.js + MongoDB Web App

This document walks through the codebase layer by layer, explaining **why** each piece exists and **how** it connects to the rest. Read it top-to-bottom the first time, then use the section headers as a reference.

---

## Table of Contents

1. [Big Picture — How the Three Layers Talk to Each Other](#1-big-picture)
2. [MongoDB & Mongoose — Storing Data](#2-mongodb--mongoose)
3. [Node.js & Express — The Backend API](#3-nodejs--express)
4. [Authentication — Passwords, Tokens & Middleware](#4-authentication)
5. [Angular — The Frontend Application](#5-angular)
6. [HTTP in Angular — Services, Interceptors & the Auth Flow](#6-http-in-angular)
7. [Angular Routing — Pages, Guards & Lazy Loading](#7-angular-routing)
8. [Angular Forms — Reactive Forms](#8-angular-forms)
9. [End-to-End Login Flow](#9-end-to-end-login-flow)
10. [Key Concepts Cheat Sheet](#10-key-concepts-cheat-sheet)

---

## 1. Big Picture

```
Browser (Angular)
       │  HTTP requests (JSON)
       ▼
Express API  (Node.js)   ←──── backend/src/
       │  Mongoose queries
       ▼
MongoDB  (local database)
```

- The **browser** never talks to MongoDB directly. It only knows about the Express API.
- The **Express API** receives HTTP requests, runs business logic, and reads/writes MongoDB.
- **MongoDB** stores documents (JSON-like objects) on disk.

The three entry points are:
| Layer | File | What it does |
|---|---|---|
| Frontend | `frontend/src/main.ts` | Bootstraps the Angular app |
| Backend | `backend/src/server.ts` | Starts Express and connects to MongoDB |
| Config | `backend/.env` | Holds secrets (DB URL, JWT key) |

---

## 2. MongoDB & Mongoose

### What is MongoDB?

MongoDB stores data as **documents** (like JavaScript objects) inside **collections** (like database tables). There is no fixed schema enforced by the database itself — Mongoose adds that structure in code.

### Mongoose Schema → Model → Document

The pattern is always the same: define a **Schema** (shape), wrap it in a **Model** (the query interface), use the model in services.

```ts
// backend/src/models/user.model.ts

import { Schema, model, Document } from 'mongoose';

// 1. TypeScript interface — describes a document's shape
export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  createdAt: Date;
}

// 2. Schema — enforces the shape at the Mongoose level
const userSchema = new Schema<IUser>(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true }
  },
  { timestamps: true }   // adds createdAt and updatedAt automatically
);

// 3. Index — tells MongoDB to build a fast lookup on the email field
userSchema.index({ email: 1 });

// 4. Model — the object you call .find(), .create(), etc. on
export const User = model<IUser>('User', userSchema);
```

### Key Schema Options

| Option | Meaning |
|---|---|
| `required: true` | Field must be present; Mongoose throws a ValidationError if missing |
| `unique: true` | MongoDB creates a unique index; duplicate emails are rejected |
| `lowercase: true` | Mongoose lowercases the value before saving |
| `trim: true` | Strips leading/trailing whitespace before saving |
| `{ timestamps: true }` | Auto-manages `createdAt` and `updatedAt` fields |

### Common Mongoose Query Methods

```ts
// Find one document matching a filter
const user = await User.findOne({ email: 'a@b.com' });

// Find one, but return a plain JS object instead of a Mongoose Document
// .lean() is faster for read-only use because it skips Mongoose overhead
const user = await User.findOne({ email: 'a@b.com' }).lean();

// Create a new document and save it
const user = await User.create({ name: 'Alice', email: 'a@b.com', password: '...' });

// Find by MongoDB's auto-generated _id
const user = await User.findById('64a1f...');
```

### Connecting to MongoDB

```ts
// backend/src/config/db.ts

import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGO_URI!;  // e.g. mongodb://localhost:27017/myapp
  await mongoose.connect(uri);
  console.log('MongoDB connected');
}
```

`mongoose.connect()` returns a Promise. The backend waits for it to resolve before starting the HTTP server (see `server.ts` below).

---

## 3. Node.js & Express

### Startup Sequence

```ts
// backend/src/server.ts

import 'dotenv/config';       // loads .env into process.env — must be first
import app from './app';
import { connectDB } from './config/db';

const PORT = Number(process.env.PORT) || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);           // exit — the app is useless without a DB
  });
```

The server only starts listening for HTTP requests **after** MongoDB is connected. If the DB is unreachable, the process exits immediately rather than serving broken requests.

### The Express App

```ts
// backend/src/app.ts

import express from 'express';
import cors from 'cors';
import { errorHandler } from './middleware/error.middleware';
import router from './routes/index.route';

const app = express();

// Middleware — run for every request, in order:
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:4200' }));
app.use(express.json());     // parse incoming JSON bodies into req.body

// Routes — only run when the path matches /api
app.use('/api', router);

// Error handler — only runs when next(err) is called
app.use(errorHandler);

export default app;
```

### The Middleware Pipeline

Express processes a request through a **pipeline** of functions. Each function receives `(req, res, next)` and either:
- Sends a response (`res.json(...)`) — the pipeline stops.
- Calls `next()` — passes control to the next function.
- Calls `next(err)` — skips to the error handler.

```
Incoming request
       │
       ▼
   cors()          ← adds CORS headers, rejects disallowed origins
       │
       ▼
  express.json()   ← parses body text → req.body object
       │
       ▼
  /api router      ← matches routes and calls handler functions
       │
       ▼ (only if next(err) was called)
  errorHandler     ← formats the error as JSON and sends it
```

### Route Files

Routes are split by resource. `index.route.ts` is the top-level router that mounts sub-routers:

```ts
// backend/src/routes/index.route.ts
import { Router } from 'express';
import authRouter from './auth.route';

const router = Router();
router.use('/auth', authRouter);   // all /api/auth/* routes go here
export default router;
```

Each route handler calls a service function and uses `try/catch` + `next(err)` to forward errors:

```ts
// backend/src/routes/auth.route.ts

router.post('/login', async (req, res, next) => {
  try {
    const result = await login(req.body);  // business logic lives in the service
    res.json({ data: result });            // success: wrap in { data }
  } catch (err) {
    next(err);                             // failure: let errorHandler deal with it
  }
});
```

**Why separate routes from services?** Routes handle HTTP concerns (status codes, request parsing). Services handle business logic (password checking, DB queries). This makes services easy to test without an HTTP server.

---

## 4. Authentication

Authentication uses two industry-standard libraries:
- **bcrypt** — safely hashes passwords before storing them
- **jsonwebtoken (JWT)** — creates signed tokens that prove identity

### Password Hashing with bcrypt

```ts
// backend/src/services/auth.service.ts

const SALT_ROUNDS = 12;

// Registration — hash then store
const hashed = await bcrypt.hash(body.password, SALT_ROUNDS);
await User.create({ ...body, password: hashed });

// Login — compare plain text against the stored hash
const match = await bcrypt.compare(body.password, user.password);
```

**Why not store the plain password?** If your database is ever leaked, attackers get hashes instead of real passwords. bcrypt is deliberately slow (the `12` rounds make each hash take ~300ms), making brute-force attacks impractical.

### JWT — JSON Web Tokens

A JWT is a base64-encoded string in three parts: `header.payload.signature`.

```ts
// Signing — create a token that proves the user is who they say they are
const token = jwt.sign(
  { sub: user._id, email: user.email },  // payload (not secret, just signed)
  process.env.JWT_SECRET!,               // secret key only the server knows
  { expiresIn: '7d' }                    // token expires in 7 days
);
```

```ts
// Verifying — check the token on protected routes
const payload = jwt.verify(token, process.env.JWT_SECRET!);
// throws if token is expired, tampered with, or signed with a different key
```

### Auth Middleware

The `requireAuth` middleware protects any route you attach it to:

```ts
// backend/src/middleware/auth.middleware.ts

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing token' });
    return;                      // stop the pipeline
  }

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!);
    req.user = payload;          // attach decoded user to the request object
    next();                      // let the actual route handler run
  } catch {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
}
```

Usage on a protected route:

```ts
router.get('/profile', requireAuth, async (req: AuthRequest, res) => {
  res.json({ data: req.user });  // req.user was set by requireAuth
});
```

### Global Error Handler

```ts
// backend/src/middleware/error.middleware.ts

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction) {
  const status = err.status ?? 500;
  // Don't leak internal details for 5xx errors
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ error: err.name ?? 'Error', message });
}
```

Notice the four-argument signature `(err, req, res, next)` — this is how Express knows it's an error handler, not a regular middleware.

Errors are thrown in services with a `status` property attached:

```ts
throw Object.assign(new Error('Email already in use'), { status: 409 });
```

---

## 5. Angular

### Application Bootstrap

```ts
// frontend/src/main.ts

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch(console.error);
```

`bootstrapApplication` is the modern (Angular 17+) way to start an app. It replaces the old `AppModule`. The second argument `appConfig` provides global services and configuration.

### App Config — The Provider Array

```ts
// frontend/src/app/app.config.ts

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),  // performance tuning
    provideRouter(routes),                                   // sets up the router
    provideHttpClient(withInterceptors([authInterceptor]))   // enables HTTP + auth
  ]
};
```

**Providers** are how Angular's dependency injection (DI) system knows what is available. Instead of importing modules (`HttpClientModule`), modern Angular uses `provide*` functions.

### Standalone Components

Every component in this codebase is **standalone** — it declares its own dependencies directly instead of relying on a shared module:

```ts
// frontend/src/app/features/auth/login/login.component.ts

@Component({
  selector: 'app-login',
  standalone: true,              // this component does not belong to any NgModule
  imports: [ReactiveFormsModule],// declare what this component needs in its template
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  // ...
}
```

**Why standalone?** It makes each component self-contained and easier to understand — you can see all its dependencies at a glance.

### Dependency Injection with `inject()`

Angular's DI system provides services automatically. The modern approach is the `inject()` function:

```ts
export class LoginComponent {
  private fb   = inject(FormBuilder);   // Angular creates and provides this
  private auth = inject(AuthService);   // our own singleton service
  private router = inject(Router);      // Angular's built-in router
}
```

You do not call `new AuthService()` manually. Angular manages the lifecycle and shares one instance across the entire app (`providedIn: 'root'`).

### Signals — Reactive State

Signals are Angular's built-in reactive primitive (introduced in Angular 17). A signal is a value that notifies Angular when it changes.

```ts
// frontend/src/app/core/services/auth.service.ts

private _loggedIn = signal(!!localStorage.getItem('token'));
//                  ^^^^^^ initial value — true if a token exists

isLoggedIn() {
  return this._loggedIn();  // reading a signal: call it like a function
}

login(...) {
  return this.api.post(...).pipe(
    tap(({ token }) => {
      localStorage.setItem('token', token);
      this._loggedIn.set(true);  // updating a signal: .set()
    })
  );
}
```

Compared to RxJS BehaviorSubject, signals are simpler for local state that doesn't need to be composed with other streams.

---

## 6. HTTP in Angular

### ApiService — The HTTP Wrapper

```ts
// frontend/src/app/core/services/api.service.ts

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;  // http://localhost:3000/api

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.base}/${path}`);
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.base}/${path}`, body);
  }
  // ...
}
```

All HTTP calls go through `ApiService`. This means:
- The base URL is defined in one place (the environment file).
- Feature services never import `HttpClient` directly — they just call `this.api.get(...)`.

### Observables — The Return Type of HTTP Calls

`HttpClient` returns **Observables** (from the RxJS library). An Observable is a lazy stream — the HTTP request does **not** fire until something subscribes to it.

```ts
// This does NOT make an HTTP request yet:
const obs = this.api.post('auth/login', { email, password });

// The request fires when you subscribe:
obs.subscribe({
  next: result => console.log(result),
  error: err  => console.error(err)
});
```

The `tap` operator in `AuthService.login()` is a side-effect operator — it runs a function when a value passes through the stream, without changing the value:

```ts
return this.api.post<{ token: string }>('auth/login', { email, password }).pipe(
  tap(({ token }) => {
    localStorage.setItem('token', token);  // side effect
    this._loggedIn.set(true);
    // the { token } value passes through unchanged to the subscriber
  })
);
```

### HTTP Interceptor — Attaching the Token

An interceptor is a function that runs for every outgoing HTTP request. This one attaches the JWT to the `Authorization` header:

```ts
// frontend/src/app/core/interceptors/auth.interceptor.ts

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token');

  if (!token) {
    return next(req);  // no token, send request as-is
  }

  // req.clone() creates a modified copy — requests are immutable
  return next(req.clone({
    setHeaders: { Authorization: `Bearer ${token}` }
  }));
};
```

The interceptor is registered once in `app.config.ts` via `withInterceptors([authInterceptor])` and runs automatically for all `HttpClient` calls.

---

## 7. Angular Routing

### Route Configuration

```ts
// frontend/src/app/app.routes.ts

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

  {
    path: 'dashboard',
    canActivate: [authGuard],       // guard: blocks access if not logged in
    loadComponent: () =>
      import('./features/dashboard/dashboard.component')
        .then(m => m.DashboardComponent)  // lazy loaded — JS bundle only downloaded when needed
  },

  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component')
        .then(m => m.LoginComponent)
  },

  { path: '**', redirectTo: 'dashboard' }  // catch-all for unknown paths
];
```

**Lazy loading** (`loadComponent` with a dynamic `import()`) means the login and dashboard code are in separate JavaScript bundles. The browser only downloads the dashboard bundle when the user actually navigates to `/dashboard`, keeping the initial page load fast.

### Route Guard

A guard is a function that runs before a route activates. It either allows navigation or redirects.

```ts
// frontend/src/app/core/guards/auth.guard.ts

export const authGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) {
    return true;                         // allow navigation
  }
  return router.createUrlTree(['/login']);  // redirect to login
};
```

`inject()` works inside guards (and interceptors) because Angular calls them within an injection context.

### Router Outlet

The `<router-outlet>` in `app.component.html` is the slot where the active route's component is rendered:

```html
<!-- frontend/src/app/app.component.html -->
<router-outlet />
```

When the URL changes to `/login`, Angular replaces the outlet's content with `LoginComponent`. When it changes to `/dashboard`, it renders `DashboardComponent`.

---

## 8. Angular Forms

### Reactive Forms

Reactive forms define the form structure in the TypeScript class, not in the HTML template. This makes validation logic easy to test.

```ts
// frontend/src/app/features/auth/login/login.component.ts

form = this.fb.group({
  email:    ['', [Validators.required, Validators.email]],  // [initial value, validators]
  password: ['', Validators.required]
});
```

`FormBuilder.group()` creates a `FormGroup` containing two `FormControl`s. The controls track the current value, whether the field has been touched, and whether it is valid.

### Binding the Form to the Template

```html
<!-- frontend/src/app/features/auth/login/login.component.html -->

<form [formGroup]="form" (ngSubmit)="submit()">
  <!-- [formGroup]="form" binds the form element to our FormGroup instance -->

  <input type="email" formControlName="email" />
  <!-- formControlName="email" connects this input to the "email" FormControl -->

  <button [disabled]="form.invalid">Sign In</button>
  <!-- [disabled] is a property binding — evaluates form.invalid and sets the attribute -->

  @if (error) {
    <p class="error">{{ error }}</p>
    <!-- @if is Angular's built-in control flow (replaces *ngIf) -->
    <!-- {{ error }} is interpolation — renders the component property as text -->
  }
</form>
```

### Template Binding Syntax Summary

| Syntax | Direction | Example |
|---|---|---|
| `{{ value }}` | Component → Template (text) | `{{ error }}` |
| `[property]="expr"` | Component → Template (attribute/property) | `[disabled]="form.invalid"` |
| `(event)="handler()"` | Template → Component | `(ngSubmit)="submit()"` |
| `[(ngModel)]="prop"` | Two-way (template-driven only) | not used here |
| `formControlName="x"` | Links input to reactive FormControl | `formControlName="email"` |

---

## 9. End-to-End Login Flow

This traces a single login attempt through all three layers.

```
User types email + password and clicks "Sign In"
        │
        │ (ngSubmit) fires
        ▼
LoginComponent.submit()
  ├── checks form.invalid → false, continue
  └── calls AuthService.login(email, password)
                │
                │ returns Observable<{ token }>
                ▼
          AuthService.login()
            └── calls ApiService.post('auth/login', { email, password })
                          │
                          │ returns Observable<{ token }>
                          ▼
                    HttpClient.post(...)
                          │
                          │ authInterceptor runs:
                          │   no token in localStorage yet → passes request as-is
                          ▼
                    HTTP POST http://localhost:3000/api/auth/login
                    { "email": "...", "password": "..." }
                          │
      ────────────────────┼──────────── backend boundary ────────────────
                          ▼
                    cors() middleware → origin ok
                    express.json() → parses body into req.body
                    /api router → matches /auth/login
                          │
                          ▼
                    auth.route.ts POST /login handler
                      └── calls auth.service.login(req.body)
                                    │
                                    ▼
                              auth.service.ts login()
                                ├── User.findOne({ email }) — queries MongoDB
                                ├── bcrypt.compare(password, user.password) → true
                                └── jwt.sign({ sub, email }, secret) → token string
                                    │
                          ◄─────────┘
                    res.json({ data: { token } })
                          │
      ────────────────────┼──────────── frontend boundary ────────────────
                          ▼
                    Observable emits { data: { token } }
                          │
                          ▼
                    tap() in AuthService.login()
                      ├── localStorage.setItem('token', token)
                      └── this._loggedIn.set(true)
                          │
                          ▼
                    LoginComponent subscribe next()
                      └── router.navigate(['/dashboard'])
                                    │
                                    ▼
                              authGuard runs
                                └── auth.isLoggedIn() → true → allow
                                          │
                                          ▼
                                  DashboardComponent loaded
```

---

## 10. Key Concepts Cheat Sheet

### MongoDB / Mongoose
| Concept | One-liner |
|---|---|
| Document | A JSON-like record stored in MongoDB |
| Collection | A group of documents (like a table) |
| Schema | Defines the shape and rules for documents in code |
| Model | The class you call `.find()`, `.create()` etc. on |
| `.lean()` | Returns plain JS objects instead of Mongoose Documents — faster for reads |
| Index | A lookup structure that speeds up queries on a field |
| `timestamps: true` | Auto-creates `createdAt` and `updatedAt` fields |

### Node.js / Express
| Concept | One-liner |
|---|---|
| Middleware | A function `(req, res, next)` that runs for matching requests |
| `next()` | Passes control to the next middleware |
| `next(err)` | Skips to the error-handler middleware |
| Router | A mini Express app for grouping related routes |
| `req.body` | Parsed request body (populated by `express.json()`) |
| `req.params` | URL path parameters, e.g. `/users/:id` → `req.params.id` |

### Authentication
| Concept | One-liner |
|---|---|
| bcrypt | One-way password hashing — you can verify but not reverse |
| Salt rounds | How slow bcrypt is — 12 is the recommended value |
| JWT | A signed token that proves identity without querying the DB |
| `jwt.sign` | Creates a token from a payload and a secret |
| `jwt.verify` | Validates and decodes a token; throws if invalid |
| Bearer token | Convention: `Authorization: Bearer <token>` HTTP header |

### Angular
| Concept | One-liner |
|---|---|
| Standalone component | A component that declares its own dependencies; no NgModule needed |
| `inject()` | Gets a service instance from Angular's DI system |
| `signal()` | A reactive value that notifies Angular when changed |
| `Observable` | A lazy stream; the HTTP request fires only when subscribed |
| `tap()` | Runs a side effect in an Observable pipeline without changing the value |
| Interceptor | A function that runs for every HTTP request — used to attach auth headers |
| Route guard (`CanActivateFn`) | A function that allows or blocks navigation to a route |
| `loadComponent` | Lazy-loads a component only when its route is visited |
| `[property]` | Property binding — component → template |
| `(event)` | Event binding — template → component |
| `{{ value }}` | Interpolation — renders a value as text |
| `@if` | Built-in control flow for conditional rendering |
| `FormGroup` / `FormControl` | Reactive form tree that tracks values and validation state |
