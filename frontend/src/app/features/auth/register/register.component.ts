import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);

  /**
   * Reactive form with three fields.
   * minLength(6) on password enforces a basic strength requirement.
   */
  form = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  error = '';

  submit() {
    if (this.form.invalid) return;
    const { name, email, password } = this.form.getRawValue();
    this.auth.register(name!, email!, password!).subscribe({
      // navigation to /login is handled inside AuthService.register() via tap()
      error: () => (this.error = 'Registration failed. Email may already be in use.')
    });
  }
}
