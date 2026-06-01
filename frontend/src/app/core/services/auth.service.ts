import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);
  private _loggedIn = signal(!!localStorage.getItem('token'));

  isLoggedIn() {
    return this._loggedIn();
  }

  login(email: string, password: string) {
    return this.api.post<{ token: string }>('auth/login', { email, password }).pipe(
      tap(({ token }) => {
        localStorage.setItem('token', token);
        this._loggedIn.set(true);
      })
    );
  }

  logout() {
    localStorage.removeItem('token');
    this._loggedIn.set(false);
    this.router.navigate(['/login']);
  }
}
