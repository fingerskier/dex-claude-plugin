# dex-claude-plugin
Runs jobs in Claude on a schedule

A job is
* A cron string
* A name
* A prompt

If `dude` is installed it uses that to log tasks and outcomes.


## Tools

* "Add a dex job..." via a Claude prompt
* "Run dex jobs'
  * displays the next scheduled job
  * displays when a job starts and creates a dude record for it
  * displays brief results when a job finishes and updates the dude task for it (completed, failed, etc)
  * wait for next job...
