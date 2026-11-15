# Round 3 answers, BLIND

Model names are replaced by letters, shuffled again for every test. Grade, then read hydrogen-round3-key.json.


## m-alt-trap
Question: Does the series sum_{n=1}^inf (-1)^n * n/(n+1) converge or diverge? Give the final value on the last line as: Answer: <value> (converges or diverges)
Reference: diverges (terms do not tend to 0; the alternating series test does not apply)

### m-alt-trap:A
By the term test (divergence test), a series $\sum a_n$ can only converge if $\lim_{n \to \infty} a_n = 0$. 

Here, $\lim_{n \to \infty} \frac{n}{n+1} = 1$, so the terms $(-1)^n \frac{n}{n+1}$ oscillate between values approaching $1$ and $-1$ and do not approach $0$. What would happen if the general term were $(-1)^n \frac{1}{n+1}$ instead?

Answer: diverges

### m-alt-trap:B
By the $n$-th term test for divergence, a series $\sum a_n$ can only converge if $\lim_{n \to \infty} a_n = 0$.

Here, $a_n = (-1)^n \frac{n}{n+1}$. As $n \to \infty$, $\frac{n}{n+1} \to 1$, so $a_n$ oscillates between values approaching $1$ and $-1$ and does not approach $0$. Therefore, the series diverges.

Answer: diverges

### m-alt-trap:C
For a series $\sum a_n$ to converge, its terms must approach $0$ as $n \to \infty$ (the $n$-th term test).

Here, $\frac{n}{n+1} \to 1$, so $(-1)^n \frac{n}{n+1}$ alternates between values near $1$ and $-1$ and never approaches $0$. Because $\lim_{n \to \infty} a_n \neq 0$, the series cannot converge.

Answer: diverges

### m-alt-trap:D
For any series $\sum a_n$ to converge, its terms must approach $0$ as $n \to \infty$ (the $n$-th term test for divergence).

Here, $\lim_{n \to \infty} \frac{n}{n+1} = 1$, so the terms $a_n = (-1)^n \frac{n}{n+1}$ oscillate between values approaching $1$ and $-1$ instead of approaching $0$. Therefore, the limit $\lim_{n \to \infty} a_n$ does not exist (and is not $0$).

Answer: diverges


## m-pseries-log
Question: For which real p does the series sum_{n=2}^inf 1/(n (ln n)^p) converge? Give the final value on the last line as: Answer: <value>
Reference: p > 1 (integral test)

### m-pseries-log:A
Using the integral test (or the Cauchy condensation test), we compare the series to the improper integral $\int_2^\infty \frac{1}{x (\ln x)^p} \, dx$.

Substituting $u = \ln x$ (so $du = \frac{1}{x} \, dx$), this becomes $\int_{\ln 2}^\infty \frac{1}{u^p} \, du$, which is a standard $p$-integral that converges if and only if $p > 1$.

Answer: p > 1

### m-pseries-log:B
By the integral test (or Cauchy condensation test), we compare the series to the improper integral $\int_2^\infty \frac{1}{x (\ln x)^p} \, dx$. Using the substitution $u = \ln x$ (so $du = \frac{1}{x} \, dx$), this becomes $\int_{\ln 2}^\infty \frac{1}{u^p} \, du$, which is a standard $p$-integral that converges if and only if $p > 1$.

Answer: p > 1

### m-pseries-log:C
By the integral test, for $p > 0$ the function $f(x) = \frac{1}{x(\ln x)^p}$ is positive, continuous, and decreasing on $[2, \infty)$. Substituting $u = \ln x$ ($du = \frac{dx}{x}$) gives:

$$\int_2^\infty \frac{dx}{x(\ln x)^p} = \int_{\ln 2}^\infty \frac{du}{u^p}$$

This integral converges if and only if $p > 1$ (for $p \le 0$, $\frac{1}{n(\ln n)^p} \ge \frac{1}{n}$ for $n \ge 3$, so it diverges by comparison with the harmonic series).

Answer: p > 1

### m-pseries-log:D
Use the integral test with $f(x) = \frac{1}{x(\ln x)^p}$ (for $p \le 0$, $\frac{1}{n(\ln n)^p} \ge \frac{1}{n}$ for $n \ge 3$, so it diverges by comparison with the harmonic series; for $p > 0$, $f$ is positive and decreasing on $[2,\infty)$):

$$\int_2^\infty \frac{dx}{x(\ln x)^p} \underset{u = \ln x}{=} \int_{\ln 2}^\infty \frac{du}{u^p}$$

This improper integral converges if and only if $p > 1$ (for $p = 1$, it gives $\ln u \to \infty$; for $p < 1$, $u^{1-p} \to \infty$).

Answer: p > 1


## m-symmetry
Question: Compute the integral of sin(x)/(sin(x)+cos(x)) from 0 to pi/2. Give the final value on the last line as: Answer: <value>
Reference: pi/4 (substitute x -> pi/2 - x and add)

### m-symmetry:A
Let $I = \int_0^{\pi/2} \frac{\sin(x)}{\sin(x)+\cos(x)}\,dx$.

Using the substitution $u = \frac{\pi}{2} - x$ (so $du = -dx$, $\sin(\frac{\pi}{2}-u) = \cos(u)$, and $\cos(\frac{\pi}{2}-u) = \sin(u)$):
$$I = \int_0^{\pi/2} \frac{\cos(u)}{\sin(u)+\cos(u)}\,du$$

Adding both forms together:
$$2I = \int_0^{\pi/2} \frac{\sin(x)+\cos(x)}{\sin(x)+\cos(x)}\,dx = \int_0^{\pi/2} 1\,dx = \frac{\pi}{2}$$

Dividing by $2$ gives $I = \frac{\pi}{4}$.

Answer: pi/4

### m-symmetry:B
Let $I = \int_0^{\pi/2} \frac{\sin(x)}{\sin(x) + \cos(x)} \, dx$.

Substitute $u = \frac{\pi}{2} - x$ (so $du = -dx$, $\sin(x) = \cos(u)$, and $\cos(x) = \sin(u)$):
$$I = \int_0^{\pi/2} \frac{\cos(u)}{\cos(u) + \sin(u)} \, du = \int_0^{\pi/2} \frac{\cos(x)}{\sin(x) + \cos(x)} \, dx$$

Adding the two forms of $I$:
$$2I = \int_0^{\pi/2} \frac{\sin(x) + \cos(x)}{\sin(x) + \cos(x)} \, dx = \int_0^{\pi/2} 1 \, dx = \frac{\pi}{2}$$

So $I = \frac{\pi}{4}$.

Answer: pi/4

### m-symmetry:C
Let $I = \int_0^{\pi/2} \frac{\sin x}{\sin x + \cos x} \, dx$.

Using the substitution $u = \frac{\pi}{2} - x$ (since $\sin(\frac{\pi}{2} - u) = \cos u$ and $\cos(\frac{\pi}{2} - u) = \sin u$), the integral becomes:
$$I = \int_0^{\pi/2} \frac{\cos u}{\cos u + \sin u} \, du$$

Adding the two expressions for $I$ together gives:
$$2I = \int_0^{\pi/2} \frac{\sin x + \cos x}{\sin x + \cos x} \, dx = \int_0^{\pi/2} 1 \, dx = \frac{\pi}{2}$$

Dividing by 2 gives $I = \frac{\pi}{4}$.

Answer: pi/4

### m-symmetry:D
Use the symmetry substitution $u = \frac{\pi}{2} - x$ (so $\sin x = \cos u$ and $\cos x = \sin u$):

$$I = \int_0^{\pi/2} \frac{\sin x}{\sin x + \cos x}\,dx = \int_0^{\pi/2} \frac{\cos u}{\cos u + \sin u}\,du$$

Adding the two forms of $I$ together cancels the denominator:

$$2I = \int_0^{\pi/2} \frac{\sin x + \cos x}{\sin x + \cos x}\,dx = \int_0^{\pi/2} 1\,dx = \frac{\pi}{2}$$

Dividing by $2$ gives $I = \frac{\pi}{4}$.

Answer: pi/4


## m-hard-integral
Question: Compute the integral of ln(1+x)/(1+x^2) from 0 to 1. Give the final value on the last line as: Answer: <value>
Reference: (pi/8) ln 2 ≈ 0.2722 (x = tan t, then t -> pi/4 - t)

### m-hard-integral:A
Substitute $x = \tan\theta$, so $dx = \sec^2\theta\,d\theta$ and $1+x^2 = \sec^2\theta$:

$$I = \int_0^{\pi/4} \ln(1 + \tan\theta)\,d\theta$$

Use the symmetry $\theta \mapsto \frac{\pi}{4} - \theta$, noting that $1 + \tan\left(\frac{\pi}{4} - \theta\right) = 1 + \frac{1 - \tan\theta}{1 + \tan\theta} = \frac{2}{1 + \tan\theta}$:

$$I = \int_0^{\pi/4} \ln\left(\frac{2}{1 + \tan\theta}\right) d\theta = \int_0^{\pi/4} \ln 2\,d\theta - I = \frac{\pi}{4}\ln 2 - I$$

Solving for $I$ gives $2I = \frac{\pi}{4}\ln 2$, so $I = \frac{\pi}{8}\ln 2$.

Answer: pi*ln(2)/8

### m-hard-integral:B
Let $I = \int_0^1 \frac{\ln(1+x)}{1+x^2}\,dx$. 

Use the trig substitution $x = \tan\theta$, so $dx = \sec^2\theta\,d\theta$ and $1+x^2 = \sec^2\theta$, with limits from $0$ to $\frac{\pi}{4}$:
$$I = \int_0^{\pi/4} \ln(1+\tan\theta)\,d\theta$$

Now apply the symmetry identity $\int_0^a f(\theta)\,d\theta = \int_0^a f(a-\theta)\,d\theta$ with $a = \frac{\pi}{4}$. Since $\tan\left(\frac{\pi}{4}-\theta\right) = \frac{1-\tan\theta}{1+\tan\theta}$, we have:
$$1 + \tan\left(\frac{\pi}{4}-\theta\right) = \frac{2}{1+\tan\theta}$$

Substituting this in gives:
$$I = \int_0^{\pi/4} \ln\left(\frac{2}{1+\tan\theta}\right)\,d\theta = \int_0^{\pi/4} \ln 2\,d\theta - \int_0^{\pi/4} \ln(1+\tan\theta)\,d\theta = \frac{\pi}{4}\ln 2 - I$$

Adding $I$ to both sides gives $2I = \frac{\pi}{4}\ln 2$.

Answer: \frac{\pi}{8}\ln 2

### m-hard-integral:C
Let $I = \int_0^1 \frac{\ln(1+x)}{1+x^2}\,dx$.

Substitute $x = \tan\theta$, so $dx = \sec^2\theta\,d\theta$ and $1+x^2 = \sec^2\theta$:
$$I = \int_0^{\pi/4} \ln(1+\tan\theta)\,d\theta$$

Using the symmetry $\theta \mapsto \frac{\pi}{4} - \theta$ and $\tan\left(\frac{\pi}{4} - \theta\right) = \frac{1-\tan\theta}{1+\tan\theta}$:
$$1 + \tan\left(\frac{\pi}{4}-\theta\right) = \frac{2}{1+\tan\theta}$$

So:
$$I = \int_0^{\pi/4} \ln\left(\frac{2}{1+\tan\theta}\right) d\theta = \frac{\pi}{4}\ln 2 - I$$

Adding $I$ to both sides gives $2I = \frac{\pi}{4}\ln 2$, hence $I = \frac{\pi\ln 2}{8}$.

Answer: \frac{\pi \ln 2}{8}

### m-hard-integral:D
Substitute $x = \tan\theta$, so $dx = \sec^2\theta\,d\theta = (1+x^2)\,d\theta$, and the limits $0$ to $1$ become $0$ to $\frac{\pi}{4}$:

$$I = \int_0^1 \frac{\ln(1+x)}{1+x^2}\,dx = \int_0^{\pi/4} \ln(1+\tan\theta)\,d\theta$$

Using the symmetry $\theta \mapsto \frac{\pi}{4} - \theta$, note that:
$$1 + \tan\left(\frac{\pi}{4}-\theta\right) = 1 + \frac{1-\tan\theta}{1+\tan\theta} = \frac{2}{1+\tan\theta}$$

So:
$$I = \int_0^{\pi/4} \ln\left(\frac{2}{1+\tan\theta}\right)d\theta = \int_0^{\pi/4} \ln 2\,d\theta - I = \frac{\pi}{4}\ln 2 - I$$

Solving for $I$ gives $2I = \frac{\pi}{4}\ln 2$.

Answer: \frac{\pi}{8}\ln 2


## m-proof-root
Question: Show that the equation x^3 + x - 1 = 0 has exactly one real solution. Give a rigorous argument.
Reference: existence: IVT (f(0) = -1 < 0 < 1 = f(1), f continuous); uniqueness: f'(x) = 3x^2 + 1 > 0 so f is strictly increasing (or Rolle). Both parts needed.

### m-proof-root:A
Let $f(x) = x^3 + x - 1$.

**Existence:**
$f$ is a polynomial, so it is continuous on $\mathbb{R}$, and in particular on $[0, 1]$. Evaluating at the endpoints gives:
$$f(0) = -1 < 0, \qquad f(1) = 1 > 0$$
By the Intermediate Value Theorem, there exists at least one $c \in (0, 1)$ such that $f(c) = 0$.

**Uniqueness:**
$f$ is differentiable on $\mathbb{R}$ with derivative:
$$f'(x) = 3x^2 + 1$$
Since $3x^2 \ge 0$ for all $x \in \mathbb{R}$, we have $f'(x) \ge 1 > 0$ for all $x \in \mathbb{R}$.

Suppose for contradiction that there are two distinct real solutions $a < b$ with $f(a) = f(b) = 0$. Since $f$ is continuous on $[a, b]$ and differentiable on $(a, b)$, Rolle's Theorem guarantees some $d \in (a, b)$ such that $f'(d) = 0$, which contradicts $f'(x) > 0$ everywhere.

Thus, $x^3 + x - 1 = 0$ has **exactly one** real solution.

### m-proof-root:B
Let $f(x) = x^3 + x - 1$.

1. **Existence:**  
   $f$ is a polynomial, so it is continuous on $\mathbb{R}$, and in particular on $[0, 1]$. Since
   $$f(0) = -1 < 0 \quad \text{and} \quad f(1) = 1 > 0,$$
   by the Intermediate Value Theorem there exists $c \in (0, 1)$ such that $f(c) = 0$.

2. **Uniqueness:**  
   $f$ is differentiable on $\mathbb{R}$, with
   $$f'(x) = 3x^2 + 1 \ge 1 > 0 \quad \text{for all } x \in \mathbb{R}.$$
   Hence $f$ is strictly increasing on $\mathbb{R}$ (or by Rolle's theorem: two distinct roots $a < b$ would give some $\xi \in (a, b)$ with $f'(\xi) = 0$, impossible since $f'(x) > 0$). Therefore, $f$ has at most one real root.

Combining both parts, $x^3 + x - 1 = 0$ has exactly one real solution.

### m-proof-root:C
Let $f(x) = x^3 + x - 1$.

**Existence:**
Since $f$ is a polynomial, it is continuous on $\mathbb{R}$, and in particular on $[0, 1]$. Evaluating at the endpoints gives:
$$f(0) = -1 < 0 \quad \text{and} \quad f(1) = 1 > 0.$$
By the Intermediate Value Theorem, there exists at least one $c \in (0, 1)$ such that $f(c) = 0$.

**Uniqueness:**
$f$ is differentiable on $\mathbb{R}$ with derivative
$$f'(x) = 3x^2 + 1 \ge 1 > 0 \quad \text{for all } x \in \mathbb{R}.$$
Suppose for contradiction that there exist two distinct real solutions $a < b$ with $f(a) = f(b) = 0$. Since $f$ is continuous on $[a, b]$ and differentiable on $(a, b)$, Rolle's Theorem guarantees some $\xi \in (a, b)$ such that $f'(\xi) = 0$, contradicting $f'(\xi) \ge 1$.

Therefore, $x^3 + x - 1 = 0$ has exactly one real solution.

### m-proof-root:D
Let $f(x) = x^3 + x - 1$.

**Existence:**
Since $f$ is a polynomial, it is continuous on $\mathbb{R}$, and in particular on $[0, 1]$. Evaluating at the endpoints gives:
$$f(0) = -1 < 0 \quad \text{and} \quad f(1) = 1 > 0$$
By the Intermediate Value Theorem, there exists at least one $c \in (0, 1)$ such that $f(c) = 0$.

**Uniqueness:**
$f$ is differentiable on $\mathbb{R}$ with derivative:
$$f'(x) = 3x^2 + 1$$
Since $x^2 \ge 0$ for all $x \in \mathbb{R}$, we have $f'(x) \ge 1 > 0$ everywhere. Suppose for contradiction that $f$ had two distinct real roots $a < b$. By Rolle's Theorem on $[a, b]$, there would exist $d \in (a, b)$ with $f'(d) = 0$, contradicting $f'(d) > 0$. (Equivalently, $f$ is strictly increasing on $\mathbb{R}$, so it is injective.)

Therefore, $x^3 + x - 1 = 0$ has exactly one real solution.

### m-proof-root:E
This type of problem splits into two parts: **existence** (at least one root) and **uniqueness** (at most one root).

Let $f(x) = x^3 + x - 1$. Since $f$ is a polynomial, it is continuous and differentiable on $\mathbb{R}$.

1. **Existence (IVT):**
   Notice that $f(0) = -1 < 0$ and $f(1) = 1 > 0$. Since $f$ is continuous on $[0, 1]$ and $f(0) < 0 < f(1)$, by the **Intermediate Value Theorem**, there exists at least one $c \in (0, 1)$ such that $f(c) = 0$.

2. **Uniqueness (Rolle's Theorem):**
   Suppose for contradiction that there are two distinct real solutions $a < b$ such that $f(a) = f(b) = 0$. Since $f$ is continuous on $[a, b]$ and differentiable on $(a, b)$, by **Rolle's Theorem**, there must exist some $d \in (a, b)$ where $f'(d) = 0$.
   However, the derivative is:
   $$f'(x) = 3x^2 + 1$$
   Since $x^2 \ge 0$ for all $x \in \mathbb{R}$, we have $f'(x) \ge 1 > 0$ everywhere. Thus $f'(d) = 0$ is impossible, which contradicts Rolle's Theorem. (Alternatively: $f'(x) > 0$ means $f$ is strictly increasing on $\mathbb{R}$, so it is injective.)

Therefore, $x^3 + x - 1 = 0$ has **exactly one** real solution.

Does the split between using IVT for existence and Rolle's/monotonicity for uniqueness make sense, or would you like to try a similar one?

### m-proof-root:F
Let $f(x) = x^3 + x - 1$.

1. **Existence:** Since $f$ is a polynomial, it is continuous on $\mathbb{R}$, and in particular on $[0, 1]$. Evaluating at the endpoints:
   $$f(0) = -1 < 0 \quad \text{and} \quad f(1) = 1 > 0.$$
   By the Intermediate Value Theorem, there exists at least one $c \in (0, 1)$ such that $f(c) = 0$.

2. **Uniqueness:** $f$ is differentiable on $\mathbb{R}$ with
   $$f'(x) = 3x^2 + 1 \ge 1 > 0 \quad \text{for all } x \in \mathbb{R}.$$
   Suppose for contradiction that there are two distinct real solutions $a < b$, so $f(a) = f(b) = 0$. By Rolle's Theorem, there exists $\xi \in (a, b)$ such that $f'(\xi) = 0$, which contradicts $f'(x) > 0$ everywhere. (Equivalently, $f' > 0$ implies $f$ is strictly increasing on $\mathbb{R}$, so it is injective.)

Therefore, $x^3 + x - 1 = 0$ has exactly one real solution.

### m-proof-root:G
Let $f(x) = x^3 + x - 1$.

**Existence (at least one solution):**
Since $f$ is a polynomial, it is continuous on $\mathbb{R}$, and in particular on $[0, 1]$. We have:
$$f(0) = -1 < 0 \quad \text{and} \quad f(1) = 1 > 0.$$
By the Intermediate Value Theorem, there exists $c \in (0, 1)$ such that $f(c) = 0$.

**Uniqueness (at most one solution):**
Suppose for contradiction that $f$ has two distinct real roots $a < b$, so $f(a) = f(b) = 0$. Since $f$ is a polynomial, it is continuous on $[a, b]$ and differentiable on $(a, b)$. By Rolle's Theorem, there exists $t \in (a, b)$ such that $f'(t) = 0$.

However,
$$f'(x) = 3x^2 + 1 \ge 1 > 0 \quad \text{for all } x \in \mathbb{R},$$
which contradicts $f'(t) = 0$.

Therefore, $x^3 + x - 1 = 0$ has exactly one real solution.

### m-proof-root:H
To prove there is **exactly one** real solution, you split the proof into two parts: **existence** (at least one) and **uniqueness** (at most one).

Define $f(x) = x^3 + x - 1$. Since $f$ is a polynomial, it is continuous and differentiable on all of $\mathbb{R}$.

1. **Existence (Intermediate Value Theorem):**
   Evaluate $f$ at two points where the sign changes:
   - $f(0) = 0^3 + 0 - 1 = -1 < 0$
   - $f(1) = 1^3 + 1 - 1 = 1 > 0$
   Since $f$ is continuous on $[0, 1]$ and $f(0) < 0 < f(1)$, by the Intermediate Value Theorem there exists at least one $c \in (0, 1)$ such that $f(c) = 0$.

2. **Uniqueness (Rolle's Theorem / Monotonicity):**
   Suppose for contradiction that there are two distinct real roots $a < b$, so $f(a) = f(b) = 0$. Since $f$ is continuous on $[a, b]$ and differentiable on $(a, b)$, Rolle's Theorem guarantees some $d \in (a, b)$ with $f'(d) = 0$.
   However, for all $x \in \mathbb{R}$:
   $$f'(x) = 3x^2 + 1 \ge 1 > 0$$
   So $f'(x)$ is never zero, which is a contradiction. (Alternatively: $f'(x) > 0$ everywhere implies $f$ is strictly increasing on $\mathbb{R}$, so it is injective and can cross $0$ at most once.)

Therefore, $x^3 + x - 1 = 0$ has a unique real solution.

Does your course prefer the contradiction step with Rolle's Theorem, or stating directly that $f'(x) > 0 \implies f$ is strictly increasing?


## m-la-param
Question: For which values of the real parameter a does the system x+y+z=1, x+2y+az=2, x+4y+a^2 z=4 have a unique solution, no solution, or infinitely many solutions?
Reference: det = (a-1)(a-2). Unique for a != 1, 2. For a = 1 AND for a = 2: infinitely many (the right side equals column 2, so (0,1,0) always solves it). NEVER no solution.

### m-la-param:A
Set up the augmented matrix and subtract the first row from the other two ($R_2 \leftarrow R_2 - R_1$ and $R_3 \leftarrow R_3 - R_1$):

$$\begin{pmatrix} 1 & 1 & 1 & | & 1 \\ 1 & 2 & a & | & 2 \\ 1 & 4 & a^2 & | & 4 \end{pmatrix} \xrightarrow{\substack{R_2 - R_1 \\ R_3 - R_1}} \begin{pmatrix} 1 & 1 & 1 & | & 1 \\ 0 & 1 & a-1 & | & 1 \\ 0 & 3 & a^2-1 & | & 3 \end{pmatrix}$$

Now eliminate the $3$ in the third row using $R_3 \leftarrow R_3 - 3R_2$. What expression in terms of $a$ do you get in the $(3,3)$ entry and on the right-hand side of that third row?

### m-la-param:B
To solve this, write the system as an augmented matrix and use row reduction (Gaussian elimination) until the bottom-left is zeros. Then look at the last row:
- **Nonzero pivot** $\rightarrow$ unique solution
- **$0 = \text{nonzero}$** $\rightarrow$ no solution
- **$0 = 0$** $\rightarrow$ infinitely many solutions

Start by eliminating $x$ from rows 2 and 3 ($R_2 \leftarrow R_2 - R_1$ and $R_3 \leftarrow R_3 - R_1$). What do rows 2 and 3 look like after that step?

### m-la-param:C
To check when a system with a parameter has a unique, zero, or infinitely many solutions, row-reduce the augmented matrix:

$$\begin{pmatrix} 1 & 1 & 1 & \big| & 1 \\ 1 & 2 & a & \big| & 2 \\ 1 & 4 & a^2 & \big| & 4 \end{pmatrix}$$

Subtracting $R_1$ from $R_2$ and $R_3$ gives:

$$\begin{pmatrix} 1 & 1 & 1 & \big| & 1 \\ 0 & 1 & a-1 & \big| & 1 \\ 0 & 3 & a^2-1 & \big| & 3 \end{pmatrix}$$

What do you get in the bottom row after doing $R_3 \leftarrow R_3 - 3R_2$?

### m-la-param:D
To find how the number of solutions depends on $a$, write the system as an augmented matrix and row-reduce it to echelon form:

$$\left[\begin{array}{ccc|c} 1 & 1 & 1 & 1 \\ 1 & 2 & a & 2 \\ 1 & 4 & a^2 & 4 \end{array}\right]$$

Start by eliminating the $x$'s in rows 2 and 3 ($R_2 \leftarrow R_2 - R_1$ and $R_3 \leftarrow R_3 - R_1$). What matrix do you get after that step?

### m-la-param:E
To classify the solutions, write the augmented matrix and row-reduce it to echelon form:

$$\left[\begin{array}{ccc|c} 1 & 1 & 1 & 1 \\ 1 & 2 & a & 2 \\ 1 & 4 & a^2 & 4 \end{array}\right]$$

Do $R_2 \leftarrow R_2 - R_1$ and $R_3 \leftarrow R_3 - R_1$, then eliminate the second entry in $R_3$ using $R_2$.

What do you get for the last row? From that single row we'll be able to read off all three cases.

### m-la-param:F
To classify the solutions, write the system as an augmented matrix and row-reduce it to echelon form, then look at the last row:
- Nonzero entry in the $z$ column $\to$ **unique solution**
- $[0\ 0\ 0 \mid 0]$ $\to$ **infinitely many solutions**
- $[0\ 0\ 0 \mid \text{nonzero}]$ $\to$ **no solution**

Start with:
$$\left(\begin{array}{ccc|c} 1 & 1 & 1 & 1 \\ 1 & 2 & a & 2 \\ 1 & 4 & a^2 & 4 \end{array}\right)$$

Subtract $R_1$ from $R_2$ and $R_3$, then eliminate the $y$-entry in $R_3$. What do you get for the last row?

### m-la-param:G
Set up the augmented matrix and row-reduce it (eliminate $x$ from rows 2 and 3, then $y$ from row 3) so you can see when the bottom row gives a pivot, $0 = 0$, or a contradiction.

What do you get for the last row in terms of $a$?

### m-la-param:H
Reduce the augmented matrix with row operations:

$$\begin{pmatrix} 1 & 1 & 1 & \bigm| & 1 \\ 1 & 2 & a & \bigm| & 2 \\ 1 & 4 & a^2 & \bigm| & 4 \end{pmatrix} \xrightarrow{\substack{R_2 \leftarrow R_2 - R_1 \\ R_3 \leftarrow R_3 - R_1}} \begin{pmatrix} 1 & 1 & 1 & \bigm| & 1 \\ 0 & 1 & a-1 & \bigm| & 1 \\ 0 & 3 & a^2-1 & \bigm| & 3 \end{pmatrix} \xrightarrow{R_3 \leftarrow R_3 - 3R_2} \begin{pmatrix} 1 & 1 & 1 & \bigm| & 1 \\ 0 & 1 & a-1 & \bigm| & 1 \\ 0 & 0 & (a-1)(a-2) & \bigm| & 0 \end{pmatrix}$$

Looking at the last row, $(a-1)(a-2)z = 0$:

- **Unique solution:** $a \neq 1$ and $a \neq 2$ (three pivots, giving $z=0, y=1, x=0$).
- **Infinitely many solutions:** $a = 1$ or $a = 2$ (the last row becomes $0 = 0$, leaving two pivots and $z$ free).
- **No solution:** no value of $a$ (the augmented entry in the last row is $0$, so the system is never inconsistent).


## m-lhopital-trap
Question: Find the limit of (x^2 * sin(1/x)) / sin(x) as x -> 0. Give the final value on the last line as: Answer: <value>
Reference: 0 (write as (x/sin x) * x sin(1/x); L'Hopital fails because the derivative ratio has no limit)

### m-lhopital-trap:A
Rewrite the expression by splitting out $\frac{x}{\sin(x)}$:

$$\frac{x^2 \sin(1/x)}{\sin(x)} = \frac{x}{\sin(x)} \cdot x \sin(1/x)$$

As $x \to 0$:
- $\frac{x}{\sin(x)} \to 1$.
- Since $|\sin(1/x)| \le 1$, we have $-|x| \le x \sin(1/x) \le |x|$, so by the Squeeze Theorem, $x \sin(1/x) \to 0$.

Multiplying the two limits gives $1 \cdot 0 = 0$.

Answer: 0

### m-lhopital-trap:B
Rewrite the expression as:

$$\frac{x^2 \sin(1/x)}{\sin(x)} = \frac{x}{\sin(x)} \cdot x \sin(1/x)$$

As $x \to 0$:
- $\frac{x}{\sin(x)} \to 1$
- Since $-1 \le \sin(1/x) \le 1$, we have $-|x| \le x \sin(1/x) \le |x|$, so $x \sin(1/x) \to 0$ by the Squeeze Theorem.

Multiplying the two limits gives $1 \cdot 0 = 0$.

Answer: 0

### m-lhopital-trap:C
We can rewrite the expression by grouping the $\sin(x)$ with one of the $x$'s in the numerator:

$$\frac{x^2 \sin(1/x)}{\sin(x)} = \frac{x}{\sin(x)} \cdot x \sin\left(\frac{1}{x}\right)$$

Now look at the two parts as $x \to 0$:
1. $\lim_{x \to 0} \frac{x}{\sin(x)} = 1$ (standard trig limit).
2. $\lim_{x \to 0} x \sin(1/x) = 0$ by the Squeeze Theorem, since $-|x| \le x \sin(1/x) \le |x|$ and $\pm|x| \to 0$.

Multiplying the two limits gives $1 \cdot 0 = 0$.

Answer: 0

### m-lhopital-trap:D
We can split the expression into two parts:

$$\frac{x^2 \sin(1/x)}{\sin(x)} = \frac{x}{\sin(x)} \cdot \left(x \sin\left(\frac{1}{x}\right)\right)$$

As $x \to 0$:
1. $\lim_{x \to 0} \frac{x}{\sin(x)} = 1$ (standard trigonometric limit).
2. $\lim_{x \to 0} x \sin(1/x) = 0$ by the Squeeze Theorem, since $-|x| \le x \sin(1/x) \le |x|$.

By the product rule for limits, $1 \cdot 0 = 0$.

Answer: 0


## m-interval
Question: Find the exact interval of convergence (including endpoints) of sum_{n=1}^inf (x-2)^n / (n * 3^n). Give the final value on the last line as: Answer: <value>
Reference: [-1, 5): R = 3; x = -1 alternating harmonic converges, x = 5 harmonic diverges

### m-interval:A
Using the Ratio Test on $a_n = \frac{(x-2)^n}{n \cdot 3^n}$:

$$\lim_{n \to \infty} \left|\frac{a_{n+1}}{a_n}\right| = \lim_{n \to \infty} \frac{|x-2|}{3} \cdot \frac{n}{n+1} = \frac{|x-2|}{3} < 1 \implies |x-2| < 3 \implies -1 < x < 5$$

Checking the endpoints:
- At $x = -1$: $\sum_{n=1}^\infty \frac{(-3)^n}{n \cdot 3^n} = \sum_{n=1}^\infty \frac{(-1)^n}{n}$, which converges by the Alternating Series Test.
- At $x = 5$: $\sum_{n=1}^\infty \frac{3^n}{n \cdot 3^n} = \sum_{n=1}^\infty \frac{1}{n}$, which is the divergent harmonic series.

Answer: [-1, 5)

### m-interval:B
Using the Ratio Test:
$$\lim_{n \to \infty} \left|\frac{(x-2)^{n+1}}{(n+1)3^{n+1}} \cdot \frac{n3^n}{(x-2)^n}\right| = \frac{|x-2|}{3} < 1 \implies |x-2| < 3 \implies -1 < x < 5$$

Checking the endpoints:
- **$x = -1$:** $\sum_{n=1}^{\infty} \frac{(-3)^n}{n \cdot 3^n} = \sum_{n=1}^{\infty} \frac{(-1)^n}{n}$, the alternating harmonic series, which converges.
- **$x = 5$:** $\sum_{n=1}^{\infty} \frac{3^n}{n \cdot 3^n} = \sum_{n=1}^{\infty} \frac{1}{n}$, the harmonic series, which diverges.

Answer: [-1, 5)

### m-interval:C
Using the ratio test on $a_n = \frac{(x-2)^n}{n \cdot 3^n}$:
$$\lim_{n\to\infty} \left|\frac{a_{n+1}}{a_n}\right| = \lim_{n\to\infty} \frac{n}{n+1} \cdot \frac{|x-2|}{3} = \frac{|x-2|}{3}$$
The series converges when $\frac{|x-2|}{3} < 1$, which gives $-1 < x < 5$.

Checking the endpoints:
- $x = -1$: $\sum_{n=1}^\infty \frac{(-3)^n}{n \cdot 3^n} = \sum_{n=1}^\infty \frac{(-1)^n}{n}$, which converges (alternating harmonic series).
- $x = 5$: $\sum_{n=1}^\infty \frac{3^n}{n \cdot 3^n} = \sum_{n=1}^\infty \frac{1}{n}$, which diverges (harmonic series).

Answer: [-1, 5)

### m-interval:D
Using the Root Test (or Ratio Test):
$$\lim_{n \to \infty} \sqrt[n]{\left|\frac{(x-2)^n}{n \cdot 3^n}\right|} = \lim_{n \to \infty} \frac{|x-2|}{3\sqrt[n]{n}} = \frac{|x-2|}{3} < 1$$
This gives $|x-2| < 3$, so the open interval is $(-1, 5)$ with radius $R = 3$.

Now check the endpoints:
- **At $x = -1$:** $\sum_{n=1}^\infty \frac{(-3)^n}{n \cdot 3^n} = \sum_{n=1}^\infty \frac{(-1)^n}{n}$, which converges by the Alternating Series Test (alternating harmonic series).
- **At $x = 5$:** $\sum_{n=1}^\infty \frac{3^n}{n \cdot 3^n} = \sum_{n=1}^\infty \frac{1}{n}$, which diverges (harmonic series).

Answer: [-1, 5)


## cpp-slicing
Question: What exactly does this program print?
Reference: ABA (show() and the array copy slice B into an A; only the reference keeps B's vtable)

### cpp-slicing:A
Here is what happens at each step:

1. `show(b)`: Since `show` takes `A` **by value** (`A a`), passing `b` causes **object slicing**—only the `A` part of `b` is copied into a new `A` object, so `a.name()` prints `"A"`.
2. `r.name()`: `r` is a **reference** (`A&`) bound directly to `b`. Polymorphism (dynamic dispatch) works through references and pointers, so it calls `B::name()` and prints `"B"`.
3. `arr[0].name()`: `A arr[1]` is an array of actual `A` objects by value, so initializing `arr[0]` with `b` also slices it into an `A`, printing `"A"`.

What would `show` need in its parameter type so it prints `"B"` too?

Answer: ABA

### cpp-slicing:B
1. `show(b)` passes `b` **by value** as an `A`, which slices off the `B` part, so `a.name()` prints `A`.
2. `r` is a reference (`A&`) bound to `b`, so virtual dispatch calls `B::name()` and prints `B`.
3. `A arr[1] = { b }` stores a copy of `b` by value in an array of `A`, slicing it again, so `arr[0].name()` prints `A`.

Answer: ABA

### cpp-slicing:C
1. `show(b)`: Takes `A` by value, which **slices** `b` into a plain `A` object, so `a.name()` prints `A`.
2. `r.name()`: `r` is a reference (`A&`) bound to `b`, so virtual dispatch works and it calls `B::name()`, printing `B`.
3. `arr[0].name()`: `arr` is an array of `A` objects by value, so initializing `arr[0]` with `b` also slices it into an `A`, printing `A`.

How would you change `show`'s parameter so it prints `B` instead?

Answer: ABA

### cpp-slicing:D
- `show(b)` takes `A` **by value**, so `b` is sliced to `A` and prints `A`.
- `r` is a reference (`A&`) bound to `b`, so `r.name()` uses virtual dispatch and prints `B`.
- `A arr[1] = { b };` stores `A` objects by value, slicing `b` again, so `arr[0].name()` prints `A`.

Answer: ABA


## cpp-ub
Question: For each snippet: is it undefined behaviour? If not, what exactly is guaranteed?
Reference: 1: UB (dangling reference to a destroyed local). 2: UB if push_back reallocates (v{1,2,3} usually has capacity 3, so in practice UB; the standard says the reference is invalidated when size exceeds capacity). 3: NOT UB: a is in a valid but unspecified state, so a.size() is fine but its value is not guaranteed (usually 0).

### cpp-ub:A
1. **Undefined behaviour.** `s` is a local variable destroyed when `f()` returns, so `f()` returns a dangling reference. (Binding to `const&` only extends the lifetime of a temporary created directly in the caller, not a reference returned from a function.)

2. **Undefined behaviour (in general).** `v` is initialized with 3 elements, so its `capacity()` is not guaranteed to be `>= 4` (usually it's 3). If `push_back(4)` reallocates, `r` is invalidated and reading it is UB. Only if `v.capacity() >= 4` beforehand is `r` guaranteed to remain valid and print `1`.

3. **Not undefined behaviour.** Moving from `a` leaves it in a **valid but unspecified state**. Calling `a.size()` is completely safe, though its exact return value is not guaranteed (commonly `0`, but not required by the standard).

Want to check why `std::string` guarantees a valid state after `std::move` while `f()` in #1 is UB even with `const&`?

### cpp-ub:B
**1. Undefined behaviour.**
`s` is a local variable destroyed when `f()` returns, so `f()` returns a dangling reference. (`const&` only extends a temporary's lifetime when bound directly at the creation site, not across a `return`.) Printing the result dereferences that dangling reference.

**2. Undefined behaviour (not guaranteed safe).**
`v` starts with 3 elements, so its `capacity()` is typically 3 (only `>= 3` is guaranteed). `push_back(4)` triggers a reallocation when `size() == capacity()`, which invalidates all references to elements—making `r` dangle when `std::cout << r` reads it.

**3. Not undefined behaviour.**
A moved-from `std::string` is guaranteed to be in a **valid, unspecified state**, so calling `a.size()` (which has no preconditions) is completely safe, and `b` is guaranteed to be `"abc"`.
- **What's guaranteed:** `a.size()` returns a valid `size_t` without UB.
- **What's *not* guaranteed:** the exact number. It's usually `0`, but with Small String Optimization (SSO) an implementation is allowed to copy `"abc"` instead of stealing a buffer, leaving `a.size() == 3`.

### cpp-ub:C
1. **Undefined behaviour.** `s` is a local variable destroyed when `f()` returns, so `f()` returns a dangling reference (`const&` lifetime extension doesn't cross a `return`). Printing it reads a dead object.

2. **Potentially undefined behaviour** (and UB in practice). `v` starts with size 3, and its initial capacity is usually 3. `push_back(4)` is allowed to reallocate, which invalidates all references into `v`—making `r` dangling. Because the standard doesn't guarantee `capacity() >= 4` here, nothing is guaranteed about `r`.

3. **Not undefined behaviour.** A moved-from `std::string` is guaranteed to be in a **valid, unspecified state**, so calling `a.size()` (which has no preconditions) is safe. The exact value returned is *not* guaranteed—it could be `0` or `3` (e.g., with small-string optimization).

### cpp-ub:D
1. **Undefined behaviour.** `s` is destroyed when `f()` returns, so the returned reference is dangling and `std::cout << f()` accesses a dead object. (`const&` extends a temporary's lifetime when bound directly, not when a function returns a reference to a local.)

2. **Undefined behaviour** (not guaranteed to be valid). `std::vector` only guarantees `capacity() >= 3`, and implementations typically allocate `capacity() == 3` here. When `push_back(4)` triggers a reallocation, all references to elements—including `r`—are invalidated, making `std::cout << r` UB.

3. **Not undefined behaviour.** Moving `a` leaves it in a **valid but unspecified state**. Because `size()` has no preconditions, calling `a.size()` is guaranteed to be safe and return some valid `size_t`—you just aren't guaranteed *which* value (for `"abc"`, implementations using Small String Optimization may leave `a` empty or even keep `"abc"`).

Quick check: if `f()` returned by value (`std::string f()`) and you wrote `const std::string& r = f(); std::cout << r;`, would that still be UB?

### cpp-ub:E
1. **Undefined behaviour.** `s` is a local variable and is destroyed when `f()` returns, so `f()` returns a dangling reference. (`const&` only extends a temporary's lifetime when bound directly at the call site, not across a `return`.)

2. **Undefined behaviour (not safe).** `push_back(4)` invalidates all references into `v` if it reallocates. Nothing guarantees `v{1, 2, 3}` starts with `capacity() >= 4` (in practice `capacity()` is `3`), so `r` becomes a dangling reference and reading it is UB.

3. **Not undefined behaviour.** Moving from `a` leaves it in a **valid but unspecified state**. Calling `a.size()` is well-defined because `size()` has no preconditions—it's guaranteed to return a valid `size_t` equal to `a`'s current length, though the exact number (e.g. `0` vs something else) is not guaranteed.

Quick check: if you changed snippet 1 so `f()` returns `std::string` by value and wrote `const std::string& ref = f(); std::cout << ref;`, would that be UB or valid?

### cpp-ub:F
**1. Undefined Behaviour (UB)**
`s` is a local variable destroyed as soon as `f()` returns. Returning a reference to it leaves a dangling reference, and reading from it in `std::cout << f()` is UB.

**2. Undefined Behaviour (UB)**
Since `v` starts with `size == capacity` (3), `v.push_back(4)` forces a reallocation to a new memory buffer. That invalidates all existing references, pointers, and iterators to `v`'s elements, making `r` a dangling reference. (If you called `v.reserve(4)` before taking `r`, it would be valid and guaranteed to print `1`.)

**3. Defined Behaviour (Not UB)**
After `std::move(a)` is used to construct `b`, standard library types like `std::string` are guaranteed to be in a **valid but unspecified state**. Calling `a.size()` (or any method without preconditions, like `.empty()`, `.clear()`, or reassigning `a`) is completely safe and won't crash—the standard just doesn't guarantee *what* number `a.size()` will return (usually `0`, though not required).

Quick check on #2: what if instead of `push_back`, we did `v.pop_back()`—would `r` still be valid?

### cpp-ub:G
1. **UB.** `s` is a local variable destroyed when `f()` returns, so `f()` returns a dangling reference and `std::cout << f()` reads through it. (`const&` lifetime extension doesn't work across a `return`.)

2. **UB** (not guaranteed safe, and UB on standard implementations). `v{1, 2, 3}` isn't guaranteed to allocate extra capacity (implementations normally set `capacity() == 3`), so `push_back(4)` reallocates and invalidates `r`. Reading `r` after reallocation is UB.

3. **Not UB.** Moving from `a` leaves it in a **valid, unspecified state**. Calling `a.size()` has no preconditions, so it's guaranteed to run safely and return a valid `size_t` matching `a`'s current contents—but the value itself is **not** guaranteed to be `0` (e.g., with Small String Optimization, `a` might still hold `"abc"`).

Quick check: what's the simplest change to snippet 2 that would make `std::cout << r` guaranteed valid?

### cpp-ub:H
**1. Undefined Behaviour (Yes)**
`s` is a local variable destroyed as soon as `f()` returns. Returning `const std::string&` leaves a dangling reference, and reading it in `std::cout << f()` is UB. (Lifetime extension only works when binding a `const&` directly to a temporary, not through a function return).

**2. Undefined Behaviour (Yes)**
`v{1, 2, 3}` starts with a size of 3, and the standard does not guarantee any extra capacity beyond 3. Calling `v.push_back(4)` can trigger a reallocation, which invalidates all existing references (`r`) into the vector. Reading `r` afterwards is UB.

**3. Defined Behaviour (No UB)**
After `std::move(a)` is passed to `b`'s move constructor, `a` is in a **valid but unspecified state**. Calling member functions without preconditions—like `a.size()`, `a.empty()`, `a.clear()`, or reassigning `a`—is guaranteed to be safe and not crash. However, the exact number `a.size()` prints is unspecified (in practice usually `0`, especially with SSO or heap steals, though the standard doesn't require it to be `0`).

Want to check how you'd fix #2 if you needed `r` to stay valid after `push_back`?


## java-wait-deadlock
Question: Two threads share Objects a and b.
Reference: No. a.wait() releases ONLY a's monitor; t1 keeps holding b. t2 blocks forever trying to enter synchronized(b), so it never reaches notify: t1 waits forever and t2 blocks forever (a deadlock).

### java-wait-deadlock:A
**No**, `t2` will never call `a.notify()`. The two threads deadlock.

When `t1` reaches `a.wait()`:
- **`t1`** releases **only `a`'s lock** and keeps holding **`b`'s lock** (`wait()` never releases other locks a thread holds). It is now waiting for `a.notify()`.
- **`t2`** holds **nothing** and blocks right at `synchronized (b)`, waiting for `t1` to release `b`—which can't happen until `t2` notifies `a`.

If you needed `t2` to notify `t1` here, what would `t1` need to do differently with `b`?

### java-wait-deadlock:B
No, `t2` will never call `a.notify()`—the program deadlocks.

Here is why: `x.wait()` only releases the lock on **`x`**, not on any other objects the thread currently holds.

When `t1` reaches `a.wait()`:
- **`t1`** releases the lock on `a`, **keeps holding the lock on `b`**, and goes to sleep waiting to be notified on `a`.
- **`t2`** then tries to enter `synchronized (b)`, so it blocks waiting for `b` (held by `t1`) and never reaches `synchronized (a)` or `a.notify()`.

How would you change `t1` (or `t2`) so that `t2` can actually notify it without getting stuck on `b`?

### java-wait-deadlock:C
No, `t2` will never call `a.notify()` — the two threads deadlock.

When `t1` calls `a.wait()`, Java only releases the lock on `a`, **not** any other locks `t1` holds.

So once `t1` reaches `a.wait()`:
- **`t1` holds:** the lock on `b` (while waiting on `a`).
- **`t2` holds:** nothing (it is blocked waiting to acquire `b` at `synchronized (b)`).

Because `t2` can't get `b`, it never enters `synchronized (a)` and never calls `a.notify()`.

How would you change `t1` or `t2` to avoid this deadlock?

### java-wait-deadlock:D
No, `t2` will never call `a.notify()` — the two threads deadlock.

When `t1` reaches `a.wait()`:
- **`t1`** releases **only** `a`'s lock and goes to sleep waiting on `a`, while **still holding `b`'s lock**.
- **`t2`** tries to enter `synchronized (b)` first, so it blocks **holding nothing**, waiting for `b`.

Because `t1` won't release `b` until it wakes up from `a.wait()`, and `t2` can't get past `synchronized (b)` to call `a.notify()`, both threads are stuck forever.

Quick check: what happens if `t2` locks `a` first and then `b`?

### java-wait-deadlock:E
No, `t2` will never reach `a.notify()` — the program deadlocks.

Here is why: `a.wait()` only releases the lock on the object you call it on (`a`), **not** any other locks the thread is currently holding.

So when `t1` calls `a.wait()`:
- **`t1`** releases the lock on `a`, goes to sleep waiting to be notified on `a`, and **still holds the lock on `b`**.
- **`t2`** tries to enter `synchronized (b)`, so it blocks forever waiting for `b` (which `t1` is still holding). Because it can't get past `synchronized (b)`, it never acquires `a` and never calls `a.notify()`.

What would happen if `t1` called `b.wait()` instead (and `t2` called `b.notify()`)?

### java-wait-deadlock:F
No, `t2` will never call `a.notify()` — they deadlock.

Here is what each thread holds once `t1` reaches `a.wait()`:
- **`t1`:** holds **`b`'s lock**, and released **`a`'s lock** (waiting in `a`'s wait set). `wait()` only releases the lock of the object you call it on, not any other locks the thread is holding.
- **`t2`:** holds **no locks**, and is **blocked waiting for `b`'s lock** at its outer `synchronized (b)`.

Because `t1` won't release `b` until it wakes up from `a.wait()`, and `t2` can't reach `a.notify()` without acquiring `b` first, both are stuck forever.

How would you change `t1` or `t2` to avoid this deadlock?

### java-wait-deadlock:G
**No**, `t2` will never call `a.notify()` — the two threads **deadlock**.

When `t1` reaches `a.wait()`:
- **`t1` holds `b` (and releases `a`):** Calling `a.wait()` releases *only* the monitor lock on `a` and puts `t1` to sleep. Any other locks `t1` already acquired stay held, so `t1` still holds `b`.
- **`t2` holds nothing:** `t2` needs `b` first to enter `synchronized (b)`, so it blocks immediately waiting for `b`.

Since `t1` won't release `b` until it wakes up from `a.wait()`, and `t2` can't reach `a.notify()` without `b`, neither thread can move forward.

How could you change `t2` (or `t1`) so `t2` can reach `a.notify()` without blocking on `b`?

### java-wait-deadlock:H
No, `t2` will never call `a.notify()` — the two threads deadlock.

When `t1` calls `a.wait()`, Java only releases the lock on `a`, **not** any other locks `t1` holds. So while `t1` is waiting on `a`:
- **`t1` holds:** the lock on `b` (and is waiting to re-acquire `a` after being notified).
- **`t2` holds:** nothing — it is blocked trying to enter `synchronized (b)`, so it can never reach `synchronized (a)` or `a.notify()`.


## algo-minmax
Question: What is the minimum number of comparisons needed in the worst case to find both the minimum and the maximum of 100 distinct numbers? Give the final value on the last line as: Answer: <value>
Reference: 148 = ceil(3n/2) - 2 (compare in pairs)

### algo-minmax:A
By comparing elements in pairs first and then comparing only the smaller element of each pair against the current minimum and the larger against the current maximum, you need $\lceil \frac{3n}{2} \rceil - 2$ comparisons in the worst case.

For $n = 100$:
- Compare the first 2 elements (1 comparison) to initialize `min` and `max`.
- Process the remaining 98 elements in 49 pairs, with 3 comparisons per pair ($49 \times 3 = 147$).

Total: $1 + 147 = 148$.

Answer: 148

### algo-minmax:B
Pair the 100 numbers into 50 pairs and compare each pair ($50$ comparisons). The overall maximum must be among the 50 winners ($49$ comparisons to find it), and the overall minimum must be among the 50 losers ($49$ comparisons to find it). 

In general, the worst-case optimal number of comparisons is $\lceil \frac{3n}{2} \rceil - 2 = \frac{3 \cdot 100}{2} - 2 = 148$ (which is also tight by an adversary argument).

Answer: 148

### algo-minmax:C
Pair the 100 numbers into 50 pairs and compare each pair (50 comparisons). The maximum must be among the 50 winners (49 comparisons to find it), and the minimum must be among the 50 losers (49 comparisons to find it), giving $50 + 49 + 49 = 148$ comparisons.

By an adversary argument, this is optimal: each of the 99 non-minimums must lose at least once and each of the 99 non-maximums must win at least once (198 outcomes total), and at most 50 comparisons between two untouched elements can contribute 2 outcomes each, leaving at least $198 - 100 = 98$ more comparisons.

Answer: 148

### algo-minmax:D
To find both the minimum and maximum of $n$ numbers in the worst case with the fewest comparisons, you pair the elements up instead of checking each one against both `min` and `max` separately.

For $n = 100$ (even):
1. Compare the first two elements to initialize `min` and `max` (**1** comparison).
2. Process the remaining 98 elements in **49 pairs**. For each pair, compare the two elements to each other, then compare the smaller one to `min` and the larger one to `max` ($49 \times 3 = \mathbf{147}$ comparisons).

In general for even $n$, that's $\frac{3n}{2} - 2$ comparisons. What happens to the formula if $n$ is odd?

Answer: 148


## tutor hint-1 (level 1; must not give the limit 1/2 or the conclusion)
Question: Use the ratio test to decide whether the series sum_{n=1}^inf n^2 / 2^n converges.
- hint-1:1: To get started with the ratio test on $\sum_{n=1}^{\infty} \frac{n^2}{2^n}$, let's first identify our general term $a_n = \frac{n^2}{2^n}$. What expression do you get if you write down $a_{n+1}$ by replacing every $n$ with $n+1$?
- hint-1:2: To get started with the ratio test, identify the general term $a_n$ and write out $a_{n+1}$ by replacing $n$ with $n+1$. What does the ratio $\left|\frac{a_{n+1}}{a_n}\right|$ look like before you simplify it?
- hint-1:3: To get started with the ratio test, how would you write $a_n$ and $a_{n+1}$ for this series? Try setting up the ratio $|a_{n+1}/a_n|$ as your first step.
- hint-1:4: To apply the ratio test, start by identifying $a_n$ and writing out $a_{n+1}$. What does the ratio $\left|\frac{a_{n+1}}{a_n}\right|$ look like?
- hint-1:5: To get started, what is the $n$-th term $a_n$ of this series, and what do you get for $a_{n+1}$ when you replace $n$ with $n+1$?
- hint-1:6: To get started with the ratio test, what do $a_n$ and $a_{n+1}$ look like for this series? Try writing out the ratio $|a_{n+1}/a_n|$ and see what simplifies!
- hint-1:7: To get started with the ratio test, what do $a_n$ and $a_{n+1}$ look like for this series? Try writing out $\left|\frac{a_{n+1}}{a_n}\right|$ as your first step.


## tutor hint-2 (level 2; must not give the limit 1/2 or the conclusion)
Question: Use the ratio test to decide whether the series sum_{n=1}^inf n^2 / 2^n converges.
- hint-2:1: The key idea of the ratio test is to form the ratio $\left|\frac{a_{n+1}}{a_n}\right|$ of consecutive terms and see whether its limit as $n \to \infty$ is less than or greater than $1$. Start by writing out $a_n$ and $a_{n+1}$ for this series and setting up their ratio.
- hint-2:2: The key idea of the ratio test is to find the limit of $\left|\frac{a_{n+1}}{a_n}\right|$ as $n \to \infty$ and compare it to $1$. For your first step, can you write down $a_n$ and $a_{n+1}$ so you can set up that ratio?
- hint-2:3: To use the ratio test, the key idea is to set $a_n = \frac{n^2}{2^n}$ and form the ratio $\left|\frac{a_{n+1}}{a_n}\right|$ by replacing $n$ with $n+1$ to get $a_{n+1}$. What do you get when you write out $\frac{a_{n+1}}{a_n}$ and simplify it?
- hint-2:4: To apply the ratio test, start by setting up the ratio $\left|\frac{a_{n+1}}{a_n}\right|$ so you can find its limit as $n \to \infty$. Try writing out $a_{n+1}$ by replacing $n$ with $n+1$ in $\frac{n^2}{2^n}$, and then divide it by $a_n$.
- hint-2:5: The key idea of the ratio test is to set up the ratio $\left|\frac{a_{n+1}}{a_n}\right|$ for $a_n = \frac{n^2}{2^n}$ and find its limit as $n \to \infty$. Start by writing down $a_{n+1}$—what do you get when you replace $n$ with $n+1$?
- hint-2:6: The key idea of the ratio test is to compare consecutive terms by setting up the ratio $\left|\frac{a_{n+1}}{a_n}\right|$ and checking its limit as $n \to \infty$. To get started, what do you get for $a_{n+1}$ when you replace each $n$ in the series' general term $a_n$ with $n+1$?


## tutor hint-3 (level 3; must not give the limit 1/2 or the conclusion)
Question: Use the ratio test to decide whether the series sum_{n=1}^inf n^2 / 2^n converges.
- hint-3:1: You're off to a good start—next, divide by $a_n$ by multiplying by its reciprocal: $\left|\frac{a_{n+1}}{a_n}\right| = \frac{(n+1)^2}{2^{n+1}} \cdot \frac{2^n}{n^2}$. Once you simplify $\frac{2^n}{2^{n+1}}$, what expression do you get?
- hint-3:2: Nice start! Next, divide $a_{n+1}$ by $a_n$ to get $\frac{a_{n+1}}{a_n} = \frac{(n+1)^2}{2^{n+1}} \cdot \frac{2^n}{n^2} = \frac{(n+1)^2}{2n^2}$, then find the limit as $n \to \infty$.
- hint-3:3: Great start on $a_{n+1}$! Next, set up the ratio $\frac{a_{n+1}}{a_n}$ by multiplying $a_{n+1}$ by the reciprocal of $a_n$: $\frac{a_{n+1}}{a_n} = \frac{(n+1)^2}{2^{n+1}} \cdot \frac{2^n}{n^2}$—how does $\frac{2^n}{2^{n+1}}$ simplify?
- hint-3:4: Nice start! Next, divide by $a_n$ (multiplying by its reciprocal) to set up $\left|\frac{a_{n+1}}{a_n}\right| = \frac{(n+1)^2}{2^{n+1}} \cdot \frac{2^n}{n^2}$, and see how the powers of $2$ simplify.
- hint-3:5: Good start—now divide $a_{n+1}$ by $a_n$ to form the ratio: $\left|\frac{a_{n+1}}{a_n}\right| = \frac{(n+1)^2}{2^{n+1}} \cdot \frac{2^n}{n^2} = \frac{(n+1)^2}{2n^2}$. What limit $L$ do you get as $n \to \infty$, and what does the ratio test tell you from there?
- hint-3:6: Great start—next, form the ratio by multiplying $a_{n+1}$ by the reciprocal of $a_n$: $\frac{a_{n+1}}{a_n} = \frac{(n+1)^2}{2^{n+1}} \cdot \frac{2^n}{n^2} = \frac{(n+1)^2}{2n^2}$. What do you get when you take the limit of this expression as $n \to \infty$?
- hint-3:7: Nice start—next, set up the ratio by multiplying by the reciprocal of $a_n$: $\left|\frac{a_{n+1}}{a_n}\right| = \frac{(n+1)^2}{2^{n+1}} \cdot \frac{2^n}{n^2}$. What do you get once you simplify $\frac{2^n}{2^{n+1}}$?
