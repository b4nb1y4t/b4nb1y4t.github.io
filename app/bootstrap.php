<?php

declare(strict_types=1);

$config = require __DIR__ . '/config.php';

spl_autoload_register(function (string $class): void {
    $base = __DIR__ . DIRECTORY_SEPARATOR;
    $map = [
        'App\\Database' => $base . 'Database.php',
    ];
    if (isset($map[$class])) {
        require_once $map[$class];
    }
});

return $config;
