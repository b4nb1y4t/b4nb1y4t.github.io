<?php

declare(strict_types=1);

/**
 * Збирає місяці графіка з календаря: кількість днів і день тижня для 1-го числа.
 * startDay як у клієнті (DAY_NAMES: 0 = нд, 1 = пн, …) — збігається з DateTimeImmutable::format('w').
 *
 * @param array<int, array{id: string, name: string, calendar_month: int}> $definitions
 * @return array<int, array{id: string, name: string, days: int, startDay: int, year: int, calendar_month: int}>
 */
function graphics_schedule_months(int $year, array $definitions): array
{
    $out = [];
    foreach ($definitions as $def) {
        $cm = (int) ($def['calendar_month'] ?? 0);
        if ($cm < 1 || $cm > 12) {
            continue;
        }
        $first = new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $cm));
        $out[] = [
            'id' => (string) $def['id'],
            'name' => (string) $def['name'],
            'days' => (int) $first->format('t'),
            'startDay' => (int) $first->format('w'),
            'year' => $year,
            'calendar_month' => $cm,
        ];
    }

    return $out;
}

/** Рік календаря для графіка (1-ше число кожного місяця береться для цього року). */
$scheduleYear = (int) (getenv('GRAPHICS_SCHEDULE_YEAR') ?: 2026);

return [
    'db_path' => dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'schedule.sqlite',
    'seed_json' => dirname(__DIR__) . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'seed.json',
    'schedule_year' => $scheduleYear,
    'months' => graphics_schedule_months($scheduleYear, [
        ['id' => 'Березень', 'name' => 'Березень', 'calendar_month' => 3],
        ['id' => 'Квітень', 'name' => 'Квітень', 'calendar_month' => 4],
        ['id' => 'Травень', 'name' => 'Травень', 'calendar_month' => 5],
    ]),
];
