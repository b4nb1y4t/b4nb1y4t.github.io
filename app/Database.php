<?php

declare(strict_types=1);

namespace App;

use InvalidArgumentException;
use PDO;
use PDOException;
use RuntimeException;

final class Database
{
    private PDO $pdo;
    /** @var array<string, mixed> */
    private array $config;

    public function __construct(array $config)
    {
        $this->config = $config;
        $path = $config['db_path'];
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $this->pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->migrate();
        $this->maybeSeed();
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }

    private function migrate(): void
    {
        $this->pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  section TEXT NOT NULL,
  rate REAL NOT NULL DEFAULT 1,
  adult INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS hour_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  month_key TEXT NOT NULL,
  day INTEGER NOT NULL,
  value TEXT NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE(employee_id, month_key, day)
);

CREATE TABLE IF NOT EXISTS vacation_entries (
  employee_id INTEGER NOT NULL,
  month_key TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, month_key)
);

CREATE INDEX IF NOT EXISTS idx_hours_emp_month ON hour_entries(employee_id, month_key);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plu TEXT NOT NULL,
  art TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'інше'
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
SQL);
        $this->pdo->exec("UPDATE employees SET section = 'ягода' WHERE section = 'молочка'");
        $this->pdo->exec("UPDATE products SET category = 'інше' WHERE category = 'молочка'");
    }

    /** @var array<int, string> */
    public const PRODUCT_CATEGORIES = ['овочі', 'фрукти', 'гриби', 'ягода', 'інше'];

    public static function normalizeProductCategory(string $category): string
    {
        $c = mb_strtolower(trim($category), 'UTF-8');
        if ($c === 'молочка') {
            return 'інше';
        }
        return in_array($c, self::PRODUCT_CATEGORIES, true) ? $c : 'інше';
    }

    /**
     * @return array{products: array<int, array<string, mixed>>, nextProductId: int, productCategories: array<int, string>}
     */
    public function getProductsState(): array
    {
        $rows = $this->pdo
            ->query('SELECT id, plu, art, name, category FROM products ORDER BY category, name COLLATE NOCASE, id')
            ->fetchAll(PDO::FETCH_ASSOC);

        $out = [];
        foreach ($rows as $row) {
            $out[] = [
                'id' => (int) $row['id'],
                'plu' => (string) $row['plu'],
                'art' => (string) $row['art'],
                'name' => (string) $row['name'],
                'category' => self::normalizeProductCategory((string) $row['category']),
            ];
        }

        $nextId = (int) $this->pdo->query('SELECT COALESCE(MAX(id),0) + 1 FROM products')->fetchColumn();

        return [
            'products' => array_values($out),
            'nextProductId' => max(1, $nextId),
            'productCategories' => self::PRODUCT_CATEGORIES,
        ];
    }

    /**
     * @param array{plu?: string, art?: string, name?: string, category?: string} $data
     */
    public function createProduct(array $data): array
    {
        $plu = trim((string) ($data['plu'] ?? ''));
        $name = trim((string) ($data['name'] ?? ''));
        $art = trim((string) ($data['art'] ?? ''));
        
        if ($plu === '' || $name === '') {
            throw new InvalidArgumentException('PLU та назва обовʼязкові');
        }

        // Перевірка на дубліkat PLU
        if ($this->productExistsByPlu($plu)) {
            throw new InvalidArgumentException('Продукт з таким PLU вже існує в списку');
        }

        // Перевірка на дубліkat art (якщо art це не "-" та не порожній)
        if ($art !== '' && $art !== '-' && $this->productExistsByArt($art)) {
            throw new InvalidArgumentException('Продукт з таким артикулом вже існує в списку');
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO products (plu, art, name, category) VALUES (?,?,?,?)'
        );
        $stmt->execute([
            $plu,
            $art,
            $name,
            self::normalizeProductCategory((string) ($data['category'] ?? 'інше')),
        ]);

        $id = (int) $this->pdo->lastInsertId();
        $product = $this->getProductById($id);
        if ($product === null) {
            throw new RuntimeException('Failed to load new product');
        }
        return $product;
    }

    /**
     * @param array{plu?: string, art?: string, name?: string, category?: string} $data
     */
    public function updateProduct(int $id, array $data): ?array
    {
        $fields = [];
        $vals = [];
        if (array_key_exists('plu', $data)) {
            $plu = trim((string) $data['plu']);
            if ($plu === '') {
                throw new InvalidArgumentException('PLU не може бути порожнім');
            }
            // Перевірка на дубліkat PLU (крім поточного продукту)
            if ($this->productExistsByPlu($plu, $id)) {
                throw new InvalidArgumentException('Продукт з таким PLU вже існує в списку');
            }
            $fields[] = 'plu = ?';
            $vals[] = $plu;
        }
        if (array_key_exists('art', $data)) {
            $art = trim((string) $data['art']);
            // Перевірка на дубліkat art (якщо art це не "-" та не порожній і крім поточного продукту)
            if ($art !== '' && $art !== '-' && $this->productExistsByArt($art, $id)) {
                throw new InvalidArgumentException('Продукт з таким артикулом вже існує в списку');
            }
            $fields[] = 'art = ?';
            $vals[] = $art;
        }
        if (array_key_exists('name', $data)) {
            $name = trim((string) $data['name']);
            if ($name === '') {
                throw new InvalidArgumentException('Назва не може бути порожньою');
            }
            $fields[] = 'name = ?';
            $vals[] = $name;
        }
        if (array_key_exists('category', $data)) {
            $fields[] = 'category = ?';
            $vals[] = self::normalizeProductCategory((string) $data['category']);
        }
        if ($fields === []) {
            return $this->getProductById($id);
        }
        $vals[] = $id;
        $sql = 'UPDATE products SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $this->pdo->prepare($sql)->execute($vals);
        return $this->getProductById($id);
    }

    public function deleteProduct(int $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM products WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Проверка существования продукта с заданным PLU
     * @param int|null $excludeId ID продукта для исключения (для обновления)
     */
    private function productExistsByPlu(string $plu, ?int $excludeId = null): bool
    {
        if ($excludeId === null) {
            $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM products WHERE plu = ?');
            $stmt->execute([$plu]);
        } else {
            $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM products WHERE plu = ? AND id != ?');
            $stmt->execute([$plu, $excludeId]);
        }
        return (int) $stmt->fetchColumn() > 0;
    }

    /**
     * Проверка существования продукта с заданным артикулом
     * Пропускает пустые значения и "-" (неизвестный артикул)
     * @param int|null $excludeId ID продукта для исключения (для обновления)
     */
    private function productExistsByArt(string $art, ?int $excludeId = null): bool
    {
        if ($art === '' || $art === '-') {
            return false;
        }
        if ($excludeId === null) {
            $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM products WHERE art = ?');
            $stmt->execute([$art]);
        } else {
            $stmt = $this->pdo->prepare('SELECT COUNT(*) FROM products WHERE art = ? AND id != ?');
            $stmt->execute([$art, $excludeId]);
        }
        return (int) $stmt->fetchColumn() > 0;
    }

    private function getProductById(int $id): ?array
    {
        $st = $this->pdo->prepare('SELECT id, plu, art, name, category FROM products WHERE id = ?');
        $st->execute([$id]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }
        return [
            'id' => (int) $row['id'],
            'plu' => (string) $row['plu'],
            'art' => (string) $row['art'],
            'name' => (string) $row['name'],
            'category' => self::normalizeProductCategory((string) $row['category']),
        ];
    }

    private function maybeSeed(): void
    {
        $n = (int) $this->pdo->query('SELECT COUNT(*) FROM employees')->fetchColumn();
        if ($n > 0) {
            return;
        }
        $seedFile = $this->config['seed_json'] ?? '';
        if ($seedFile === '' || !is_readable($seedFile)) {
            return;
        }
        $raw = file_get_contents($seedFile);
        if ($raw === false) {
            return;
        }
        /** @var array{employees?: array<int, array<string, mixed>>, nextId?: int} $data */
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $this->importEmployeesPayload($data['employees'] ?? []);
    }

    /**
     * @param array<int, array<string, mixed>> $employees
     */
    public function importEmployeesPayload(array $employees): void
    {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->exec('DELETE FROM hour_entries');
            $this->pdo->exec('DELETE FROM vacation_entries');
            $this->pdo->exec('DELETE FROM employees');

            $insEmp = $this->pdo->prepare(
                'INSERT INTO employees (id, name, section, rate, adult) VALUES (?,?,?,?,?)'
            );
            $insHour = $this->pdo->prepare(
                'INSERT INTO hour_entries (employee_id, month_key, day, value) VALUES (?,?,?,?)'
            );
            $insVac = $this->pdo->prepare(
                'INSERT INTO vacation_entries (employee_id, month_key, hours) VALUES (?,?,?)'
            );

            foreach ($employees as $e) {
                $id = (int) ($e['id'] ?? 0);
                if ($id <= 0) {
                    continue;
                }
                $insEmp->execute([
                    $id,
                    (string) ($e['name'] ?? ''),
                    (string) ($e['section'] ?? 'сборка'),
                    (float) ($e['rate'] ?? 1),
                    !empty($e['adult']) ? 1 : 0,
                ]);

                /** @var array<string, array<string, mixed>> $hours */
                $hours = is_array($e['hours'] ?? null) ? $e['hours'] : [];
                foreach ($hours as $month => $days) {
                    if (!is_array($days)) {
                        continue;
                    }
                    foreach ($days as $day => $val) {
                        $dayNum = (int) $day;
                        $v = $this->normalizeHourValue($val);
                        if ($v === null) {
                            continue;
                        }
                        $insHour->execute([$id, (string) $month, $dayNum, $v]);
                    }
                }

                /** @var array<string, float|int> $vac */
                $vac = is_array($e['vacation'] ?? null) ? $e['vacation'] : [];
                foreach ($vac as $mk => $hv) {
                    $insVac->execute([$id, (string) $mk, (float) $hv]);
                }
            }

            $this->pdo->commit();
        } catch (PDOException $ex) {
            $this->pdo->rollBack();
            throw new RuntimeException($ex->getMessage(), 0, $ex);
        }
    }

    /**
     * @return array{employees: array<int, array<string, mixed>>, nextId: int, months: array<int, array<string, mixed>>, schedule_year: int}
     */
    public function getFullState(): array
    {
        $months = $this->config['months'];

        $emps = $this->pdo->query('SELECT id, name, section, rate, adult FROM employees ORDER BY id')
            ->fetchAll(PDO::FETCH_ASSOC);

        $hourStmt = $this->pdo->prepare(
            'SELECT month_key, day, value FROM hour_entries WHERE employee_id = ? ORDER BY month_key, day'
        );
        $vacStmt = $this->pdo->prepare(
            'SELECT month_key, hours FROM vacation_entries WHERE employee_id = ?'
        );

        $out = [];
        foreach ($emps as $row) {
            $id = (int) $row['id'];
            $hours = [];
            foreach ($months as $m) {
                $mk = $m['id'];
                $hours[$mk] = [];
            }

            $hourStmt->execute([$id]);
            while ($h = $hourStmt->fetch(PDO::FETCH_ASSOC)) {
                $mk = $h['month_key'];
                $day = (int) $h['day'];
                $val = (string) $h['value'];
                if (!isset($hours[$mk])) {
                    $hours[$mk] = [];
                }
                if (is_numeric($val)) {
                    $hours[$mk][(string) $day] = str_contains($val, '.') ? (float) $val : (int) $val;
                } elseif ($val === 'В' || $val === 'в') {
                    $hours[$mk][(string) $day] = 'В';
                } else {
                    $hours[$mk][(string) $day] = $val;
                }
            }

            $vacation = [];
            foreach ($months as $m) {
                $vacation[$m['id']] = 0;
            }
            $vacStmt->execute([$id]);
            while ($v = $vacStmt->fetch(PDO::FETCH_ASSOC)) {
                $vacation[$v['month_key']] = (float) $v['hours'];
            }

            $out[] = [
                'id' => $id,
                'name' => $row['name'],
                'section' => $row['section'],
                'rate' => (float) $row['rate'],
                'adult' => (bool) (int) $row['adult'],
                'hours' => $hours,
                'vacation' => $vacation,
            ];
        }

        $nextId = (int) $this->pdo->query('SELECT COALESCE(MAX(id),0) + 1 FROM employees')->fetchColumn();

        $year = (int) ($this->config['schedule_year'] ?? (int) date('Y'));

        return [
            'employees' => array_values($out),
            'nextId' => max(1, $nextId),
            'months' => $months,
            'schedule_year' => $year,
        ];
    }

    /**
     * @param array{name?: string, section?: string, rate?: float, adult?: bool} $data
     */
    public function createEmployee(array $data): array
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO employees (name, section, rate, adult) VALUES (?,?,?,?)'
        );
        $stmt->execute([
            (string) ($data['name'] ?? ''),
            (string) ($data['section'] ?? 'сборка'),
            (float) ($data['rate'] ?? 1),
            !empty($data['adult']) ? 1 : 0,
        ]);
        $id = (int) $this->pdo->lastInsertId();

        $insV = $this->pdo->prepare(
            'INSERT OR IGNORE INTO vacation_entries (employee_id, month_key, hours) VALUES (?,?,0)'
        );
        foreach ($this->config['months'] as $m) {
            $insV->execute([$id, $m['id']]);
        }

        $hydrated = $this->getEmployeeById($id);
        if ($hydrated === null) {
            throw new RuntimeException('Failed to load new employee');
        }
        return $hydrated;
    }

    /**
     * @param array{name?: string, section?: string, rate?: float, adult?: bool} $data
     */
    public function updateEmployee(int $id, array $data): ?array
    {
        $fields = [];
        $vals = [];
        if (isset($data['name'])) {
            $fields[] = 'name = ?';
            $vals[] = (string) $data['name'];
        }
        if (isset($data['section'])) {
            $fields[] = 'section = ?';
            $vals[] = (string) $data['section'];
        }
        if (isset($data['rate'])) {
            $fields[] = 'rate = ?';
            $vals[] = (float) $data['rate'];
        }
        if (isset($data['adult'])) {
            $fields[] = 'adult = ?';
            $vals[] = !empty($data['adult']) ? 1 : 0;
        }
        if ($fields === []) {
            return $this->getEmployeeById($id);
        }
        $vals[] = $id;
        $sql = 'UPDATE employees SET ' . implode(', ', $fields) . ' WHERE id = ?';
        $this->pdo->prepare($sql)->execute($vals);
        return $this->getEmployeeById($id);
    }

    public function deleteEmployee(int $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM employees WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    /**
     * @param mixed $raw from client
     */
    public function setHourEntry(int $employeeId, string $monthKey, int $day, $raw): void
    {
        $chk = $this->pdo->prepare('SELECT COUNT(*) FROM employees WHERE id = ?');
        $chk->execute([$employeeId]);
        $exists = (int) $chk->fetchColumn();
        if ($exists === 0) {
            throw new RuntimeException('employee not found');
        }

        if ($raw === '' || $raw === null) {
            $this->pdo->prepare(
                'DELETE FROM hour_entries WHERE employee_id = ? AND month_key = ? AND day = ?'
            )->execute([$employeeId, $monthKey, $day]);
            return;
        }

        $v = $this->normalizeHourValue($raw);
        if ($v === null) {
            return;
        }

        $this->assertDailyPlanLimit($v);

        $this->pdo->prepare(
            'INSERT INTO hour_entries (employee_id, month_key, day, value) VALUES (?,?,?,?)
           ON CONFLICT(employee_id, month_key, day) DO UPDATE SET value = excluded.value'
        )->execute([$employeeId, $monthKey, $day, $v]);
    }

    /**
     * Норма та стеля плану годин на місяць (пропорційно ставці): 176×ставка / 248×ставка.
     */
    public static function planNormForRate(float $rate): float
    {
        return round(176.0 * $rate, 2);
    }

    public static function planMaxForRate(float $rate): float
    {
        return round(248.0 * $rate, 2);
    }

    private function numericContributionFromStoredValue(string $value): float
    {
        if ($value === 'В' || strcasecmp($value, 'в') === 0) {
            return 0.0;
        }
        if (is_numeric($value)) {
            return (float) $value;
        }
        return 0.0;
    }

    private function assertDailyPlanLimit(string $newValue): void
    {
        $contribNew = $this->numericContributionFromStoredValue($newValue);
        if ($contribNew > 12.0 + 0.0001) {
            throw new InvalidArgumentException(
                'За один день не більше 12 год. плану.'
            );
        }
    }

    /**
     * @param mixed $val
     */
    private function normalizeHourValue($val): ?string
    {
        if ($val === null || $val === '') {
            return null;
        }
        if (is_string($val) && (strtoupper($val) === 'В' || $val === 'в')) {
            return 'В';
        }
        if (is_numeric($val)) {
            $f = (float) $val;
            return (string) ((floor($f) == $f) ? (int) $f : $f);
        }
        return (string) $val;
    }

    private function getEmployeeById(int $id): ?array
    {
        $st = $this->pdo->prepare('SELECT id, name, section, rate, adult FROM employees WHERE id = ?');
        $st->execute([$id]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }
        $full = $this->getFullState();
        foreach ($full['employees'] as $e) {
            if ((int) $e['id'] === $id) {
                return $e;
            }
        }
        return null;
    }
}
