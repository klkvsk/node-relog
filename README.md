## ReLog - Remote logging service

#Install it
    npm -g install relog
    
#Configure it
See `main.js` for available settings, put your parameters in `config.js` in relog's path (most likely `/usr/lib/node_modules/relog/config.js` if installed with `-g`).

#Run it
    npm -g start relog
    
#Test it
Post some test message (assuming you run ReLog locally):

    # curl -X POST "http://localhost:1095/default?type=Test&text=this%20is%20just%20for%20test"
    
You should see `ok` in response.
    
Then, open `http://localhost:1095/default` in your browser to see your message.
